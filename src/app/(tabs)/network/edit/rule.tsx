import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  applyFirewallChanges,
  deleteSectionChanges,
  getFirewall,
  trafficRuleChanges,
  validateTrafficRule,
  type FirewallZone,
  type TrafficRule,
  type TrafficRuleInput,
} from '@/api/services/firewall';
import type { UbusCall } from '@/api/ubus/types';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
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

const PROTOCOLS = ['tcp udp', 'tcp', 'udp', 'icmp', 'all'] as const;
const TARGETS: TrafficRuleInput['target'][] = ['ACCEPT', 'REJECT', 'DROP'];
const FAMILIES: TrafficRuleInput['family'][] = ['', 'ipv4', 'ipv6'];
/** "" is the router itself, "*" any zone. */
const ROUTER = '';

/** NW-6: add a traffic rule, or edit `?section=`; options the form doesn't cover stay as they are. */
export default function EditRule() {
  const t = useT();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const fw = useRouterQuery(['firewall'], getFirewall);
  const rule = useLoaded(section ? fw.data?.rules.find((r) => r.section === section && !r.managed) : undefined);
  const title = section ? t('network:firewall.editRule') : t('network:firewall.addRule');
  if (!fw.data || (section && !rule)) {
    return (
      <FormPlaceholder
        title={title}
        error={fw.error}
        onRetry={() => void fw.refetch()}
        missing={!!fw.data && !!section && !rule}
      />
    );
  }
  return <RuleForm title={title} rule={rule} zones={fw.data.zones} />;
}

function RuleForm({ title, rule, zones }: { title: string; rule?: TrafficRule; zones: FirewallZone[] }) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const [initial] = useState<TrafficRuleInput>(() => ({
    name: rule?.name ?? '',
    src: rule ? (rule.src ?? ROUTER) : (zones.find((z) => z.masq)?.name ?? 'wan'),
    dest: rule ? (rule.dest ?? ROUTER) : ROUTER,
    protocols: rule?.protocols ?? ['tcp', 'udp'],
    srcIp: rule?.srcIp.join(' ') ?? '',
    destIp: rule?.destIp.join(' ') ?? '',
    destPort: rule?.destPort ?? '',
    target: (TARGETS.includes(rule?.target as TrafficRuleInput['target'])
      ? rule?.target
      : 'ACCEPT') as TrafficRuleInput['target'],
    family: (FAMILIES.includes((rule?.family ?? '') as TrafficRuleInput['family'])
      ? (rule?.family ?? '')
      : '') as TrafficRuleInput['family'],
  }));
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateTrafficRule>>({});
  const [picker, setPicker] = useState<'src' | 'dest' | 'proto' | null>(null);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const apply = useRouterMutation((conn, changes: UbusCall[]) => applyFirewallChanges(conn, changes), [['firewall']]);

  const set = (patch: Partial<TrafficRuleInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof TrafficRuleInput) => (errors[key] ? t(`network:firewall.error.${errors[key]}`) : undefined);
  const zoneLabel = (z: string) =>
    z === ROUTER ? t('network:firewall.thisRouter') : z === '*' ? t('network:firewall.anyZone') : z;
  const zoneOptions = [
    { value: ROUTER, label: t('network:firewall.thisRouter') },
    { value: '*', label: t('network:firewall.anyZone') },
    ...zones.map((z) => ({ value: z.name, label: z.name, detail: z.networks.join(', ') })),
  ];
  const proto = input.protocols.join(' ');
  const name = rule?.name || t('network:firewall.unnamed');

  const submit = () => {
    const found = validateTrafficRule(input);
    setErrors(found);
    if (!Object.keys(found).length) setPending('save');
  };
  const run = () => {
    const kind = pending;
    setPending(null);
    const changes = kind === 'delete' && rule ? deleteSectionChanges(rule.section) : trafficRuleChanges(input, rule);
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
        onDelete={rule ? () => setPending('delete') : undefined}
        deleteLabel={t('network:firewall.delete')}
        testID="rule-form">
        {rule?.extra.length ? (
          <AppText variant="footnote" tone="secondary">
            {t('network:firewall.advancedHint', { options: rule.extra.join(', ') })}
          </AppText>
        ) : null}
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:firewall.name')}
            value={input.name}
            onChangeText={(v) => set({ name: v })}
            placeholder="Allow-SSH"
            error={err('name')}
          />
        </GlassCard>
        <ListSection>
          <ListRow
            title={t('network:firewall.source')}
            value={zoneLabel(input.src)}
            chevron
            onPress={() => setPicker('src')}
          />
          <ListRow
            title={t('network:firewall.destination')}
            value={zoneLabel(input.dest)}
            chevron
            onPress={() => setPicker('dest')}
          />
          <ListRow
            title={t('network:firewall.protocol')}
            value={
              (PROTOCOLS as readonly string[]).includes(proto) ? t(`network:firewall.proto.${proto as 'tcp'}`) : proto
            }
            chevron
            onPress={() => setPicker('proto')}
          />
        </ListSection>
        {err('dest') || err('protocols') ? (
          <AppText variant="footnote" tone="danger">
            {err('dest') ?? err('protocols')}
          </AppText>
        ) : null}
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:firewall.destPort')}
            value={input.destPort}
            onChangeText={(v) => set({ destPort: v })}
            placeholder="22 80 8000-8100"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            monospace
            error={err('destPort')}
          />
          <TextField
            label={t('network:firewall.srcIp')}
            value={input.srcIp}
            onChangeText={(v) => set({ srcIp: v })}
            placeholder={t('network:firewall.anyAddress')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={err('srcIp')}
          />
          <TextField
            label={t('network:firewall.destIp')}
            value={input.destIp}
            onChangeText={(v) => set({ destIp: v })}
            placeholder={t('network:firewall.anyAddress')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={err('destIp')}
          />
        </GlassCard>
        <GlassCard contentStyle={styles.card}>
          <AppText variant="footnote" tone="secondary">
            {t('network:firewall.action')}
          </AppText>
          <Segmented
            values={TARGETS.map((x) => t(`network:firewall.target.${x}`))}
            selectedIndex={TARGETS.indexOf(input.target)}
            onChange={(e) => set({ target: TARGETS[e.nativeEvent.selectedSegmentIndex] })}
          />
          <AppText variant="footnote" tone="secondary">
            {t('network:firewall.family')}
          </AppText>
          <Segmented
            values={[t('network:firewall.familyBoth'), 'IPv4', 'IPv6']}
            selectedIndex={FAMILIES.indexOf(input.family)}
            onChange={(e) => set({ family: FAMILIES[e.nativeEvent.selectedSegmentIndex] })}
          />
        </GlassCard>
      </FormScreen>

      <SelectSheet
        visible={picker === 'src' || picker === 'dest'}
        title={picker === 'src' ? t('network:firewall.source') : t('network:firewall.destination')}
        options={zoneOptions}
        value={picker === 'src' ? input.src : input.dest}
        onSelect={(zone) => {
          set(picker === 'src' ? { src: zone } : { dest: zone });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <SelectSheet
        visible={picker === 'proto'}
        title={t('network:firewall.protocol')}
        options={PROTOCOLS.map((p) => ({ value: p, label: t(`network:firewall.proto.${p}`) }))}
        value={proto}
        onSelect={(p) => {
          set({ protocols: p.split(' ') });
          setPicker(null);
        }}
        onCancel={() => setPicker(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending === 'delete' ? t('network:firewall.deleteTitle', { name }) : t('network:firewall.saveTitle')}
        consequences={[t('network:firewall.consequence')]}
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
