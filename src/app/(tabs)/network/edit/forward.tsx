import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import type { Client } from '@/api/services/clients';
import {
  applyFirewallChanges,
  deleteSectionChanges,
  forwardConflicts,
  getFirewall,
  portForwardChanges,
  validatePortForward,
  type FirewallZone,
  type PortForward,
  type PortForwardInput,
} from '@/api/services/firewall';
import type { UbusCall } from '@/api/ubus/types';
import { useClients, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const PROTOCOLS: PortForwardInput['protocols'][] = [['tcp'], ['udp'], ['tcp', 'udp']];

/** NW-6: add a port forward, or edit `?section=`; the device can be picked from the device list. */
export default function EditForward() {
  const t = useT();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const fw = useRouterQuery(['firewall'], getFirewall);
  const clients = useClients();
  const forward = useLoaded(section ? fw.data?.forwards.find((f) => f.section === section) : undefined);
  const title = section ? t('network:firewall.editForward') : t('network:firewall.addForward');
  if (!fw.data || (section && !forward)) {
    return (
      <FormPlaceholder
        title={title}
        error={fw.error}
        onRetry={() => void fw.refetch()}
        missing={!!fw.data && !!section && !forward}
      />
    );
  }
  return (
    <ForwardForm
      title={title}
      forward={forward}
      forwards={fw.data.forwards}
      zones={fw.data.zones}
      clients={clients.data ?? []}
    />
  );
}

function ForwardForm({
  title,
  forward,
  forwards,
  zones,
  clients,
}: {
  title: string;
  forward?: PortForward;
  forwards: PortForward[];
  zones: FirewallZone[];
  clients: Client[];
}) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const wanZone = zones.find((z) => z.masq)?.name ?? 'wan';
  const lanZone = zones.find((z) => z.name === 'lan')?.name ?? zones.find((z) => !z.masq)?.name ?? 'lan';
  const [initial] = useState<PortForwardInput>(() => ({
    name: forward?.name ?? '',
    protocols: (forward?.protocols.filter((p) => p === 'tcp' || p === 'udp') as PortForwardInput['protocols']) ?? [
      'tcp',
    ],
    srcZone: forward?.srcZone ?? wanZone,
    externalPort: forward?.externalPort ?? '',
    destZone: forward?.destZone ?? lanZone,
    internalIp: forward?.internalIp ?? '',
    internalPort: forward?.internalPort ?? '',
  }));
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validatePortForward>>({});
  const [picker, setPicker] = useState<'device' | 'src' | 'dest' | null>(null);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const apply = useRouterMutation((conn, changes: UbusCall[]) => applyFirewallChanges(conn, changes), [['firewall']]);

  const set = (patch: Partial<PortForwardInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof PortForwardInput) => (errors[key] ? t(`network:firewall.error.${errors[key]}`) : undefined);
  const conflicts = forwardConflicts(forwards, input, forward?.section);
  const protoIndex = Math.max(
    0,
    PROTOCOLS.findIndex((p) => p.join(' ') === input.protocols.join(' ')),
  );
  const name = forward?.name || t('network:firewall.unnamed');

  const submit = () => {
    const found = validatePortForward(input);
    setErrors(found);
    if (!Object.keys(found).length) setPending('save');
  };
  const run = () => {
    const kind = pending;
    setPending(null);
    const changes = kind === 'delete' && forward ? deleteSectionChanges(forward.section) : portForwardChanges(input, forward);
    apply.mutate(changes, {
      onSuccess: (outcome) => {
        if (outcome.status === 'rolled-back') {
          toast(t('network:result.rolledBack'), 'warning');
          return;
        }
        toast(t('network:result.applied'));
        exit.back();
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };

  return (
    <>
      <FormScreen
        title={title}
        dirty={differs(input, initial)}
        leaving={exit.leaving}
        onSave={submit}
        saving={apply.isPending}
        onDelete={forward ? () => setPending('delete') : undefined}
        deleteLabel={t('network:firewall.delete')}
        testID="forward-form">
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:firewall.name')}
            value={input.name}
            onChangeText={(v) => set({ name: v })}
            placeholder="NAS-HTTPS"
            error={err('name')}
          />
          <Segmented
            values={['TCP', 'UDP', 'TCP + UDP']}
            selectedIndex={protoIndex}
            onChange={(e) => set({ protocols: PROTOCOLS[e.nativeEvent.selectedSegmentIndex] })}
          />
          <TextField
            label={t('network:firewall.externalPort')}
            value={input.externalPort}
            onChangeText={(v) => set({ externalPort: v })}
            placeholder="8443"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            monospace
            error={
              err('externalPort') ??
              (conflicts.length
                ? t('network:firewall.conflict', {
                    names: conflicts.map((c) => c.name || c.externalPort).join(', '),
                  })
                : undefined)
            }
            testID="forward-external"
          />
        </GlassCard>
        <ListSection>
          <ListRow
            title={t('network:firewall.chooseDevice')}
            icon="devices"
            chevron
            onPress={() => setPicker('device')}
          />
        </ListSection>
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:firewall.internalIp')}
            value={input.internalIp}
            onChangeText={(v) => set({ internalIp: v })}
            placeholder="192.168.1.100"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            monospace
            error={err('internalIp')}
            testID="forward-ip"
          />
          <TextField
            label={t('network:firewall.internalPort')}
            value={input.internalPort}
            onChangeText={(v) => set({ internalPort: v })}
            placeholder={t('network:firewall.samePort')}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            monospace
            error={err('internalPort')}
          />
        </GlassCard>
        <ListSection>
          <ListRow
            title={t('network:firewall.srcZone')}
            value={input.srcZone}
            chevron
            onPress={() => setPicker('src')}
          />
          <ListRow
            title={t('network:firewall.destZone')}
            value={input.destZone}
            chevron
            onPress={() => setPicker('dest')}
          />
        </ListSection>
      </FormScreen>

      <SelectSheet
        visible={picker === 'device'}
        title={t('network:firewall.chooseDevice')}
        options={clients.filter((c) => c.ipv4).map((c) => ({ value: c.ipv4!, label: c.name, detail: c.ipv4 }))}
        value={input.internalIp}
        onSelect={(ip) => {
          const device = clients.find((c) => c.ipv4 === ip)?.name;
          set({ internalIp: ip, name: input.name || device || '' });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'src' || picker === 'dest'}
        title={picker === 'src' ? t('network:firewall.srcZone') : t('network:firewall.destZone')}
        options={zones.map((z) => ({ value: z.name, label: z.name, detail: z.networks.join(', ') }))}
        value={picker === 'src' ? input.srcZone : input.destZone}
        onSelect={(zone) => {
          set(picker === 'src' ? { srcZone: zone } : { destZone: zone });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending === 'delete' ? t('network:firewall.deleteTitle', { name }) : t('network:firewall.saveTitle')
        }
        consequences={[
          t('network:firewall.consequence'),
          ...(pending === 'save' ? [t('network:firewall.exposeConsequence')] : []),
        ]}
        confirmLabel={t('common:confirm')}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
