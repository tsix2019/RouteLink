import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  applyWgChanges,
  createInterfaceChanges,
  deleteInterfaceChanges,
  editInterfaceChanges,
  getWgConfig,
  suggestInterface,
  validateWgInterface,
  type WgConfigInterface,
  type WgConfigState,
  type WgInterfaceInput,
} from '@/api/services/wireguard-config';
import type { UbusCall } from '@/api/ubus/types';
import { useWgKeys } from '@/features/network/useWgKeys';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/** NW-8: create a tunnel (name, port and subnet suggested, key made by the router), or edit `?name=`. */
export default function EditWgInterface() {
  const t = useT();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const config = useRouterQuery(['wireguard-config'], getWgConfig);
  const keys = useWgKeys({ pair: !name, psk: false });
  const iface = useLoaded(name ? config.data?.interfaces.find((i) => i.name === name) : undefined);
  const title = name ? t('network:wireguard.editTunnel') : t('network:wireguard.newTunnel');
  if (!config.data || (name && !iface) || (!name && !keys.data)) {
    return (
      <FormPlaceholder
        title={title}
        error={config.error ?? (name ? undefined : keys.error)}
        onRetry={() => void Promise.all([config.refetch(), keys.refetch()])}
        missing={!!config.data && !!name && !iface}
      />
    );
  }
  return <InterfaceForm title={title} iface={iface} config={config.data} privateKey={keys.data?.pair?.privateKey} />;
}

function InterfaceForm({
  title,
  iface,
  config,
  privateKey,
}: {
  title: string;
  /** The tunnel being edited; absent when creating one. */
  iface?: WgConfigInterface;
  config: WgConfigState;
  /** A new tunnel's key, made by the router. */
  privateKey?: string;
}) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const [initial] = useState<WgInterfaceInput>(() =>
    iface
      ? {
          name: iface.name,
          privateKey: iface.privateKey,
          listenPort: iface.listenPort ?? '',
          addresses: iface.addresses.join(' '),
          mtu: iface.mtu ?? '',
          joinLan: iface.zone === 'lan',
          openPort: !!iface.portRule,
        }
      : {
          ...suggestInterface(config.interfaces, config.network),
          privateKey: privateKey ?? '',
          mtu: '',
          joinLan: true,
          openPort: true,
        },
  );
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateWgInterface>>({});
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const apply = useRouterMutation(
    (conn, changes: UbusCall[]) => applyWgChanges(conn, changes),
    [['wireguard'], ['wireguard-config'], ['firewall'], ['interfaces']],
  );

  const set = (patch: Partial<WgInterfaceInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof WgInterfaceInput) => (errors[key] ? t(`network:wireguard.error.${errors[key]!}`) : undefined);

  const submit = () => {
    const found = validateWgInterface(input, config.interfaces, config.network, iface?.name);
    setErrors(found);
    if (!Object.keys(found).length) setPending('save');
  };
  const run = () => {
    const kind = pending;
    setPending(null);
    const changes =
      kind === 'delete' && iface
        ? deleteInterfaceChanges(iface, config.firewall)
        : iface
          ? editInterfaceChanges(iface, input, config.firewall)
          : createInterfaceChanges(input, config.firewall);
    apply.mutate(changes, {
      onSuccess: (outcome) => {
        if (outcome.status === 'rolled-back') {
          toast(t('network:result.rolledBack'), 'warning');
          return;
        }
        toast(t('network:wireguard.applied'));
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
        onDelete={iface ? () => setPending('delete') : undefined}
        deleteLabel={t('network:wireguard.deleteTunnel')}
        testID="wg-iface-form">
        <GlassCard contentStyle={styles.card}>
          {iface ? null : (
            <TextField
              label={t('network:wireguard.name')}
              value={input.name}
              onChangeText={(name) => set({ name })}
              autoCapitalize="none"
              autoCorrect={false}
              monospace
              error={err('name')}
            />
          )}
          <TextField
            label={t('network:wireguard.listenPort')}
            value={input.listenPort}
            onChangeText={(listenPort) => set({ listenPort })}
            keyboardType="number-pad"
            monospace
            error={err('listenPort')}
          />
          <TextField
            label={t('network:wireguard.addresses')}
            value={input.addresses}
            onChangeText={(addresses) => set({ addresses })}
            hint={t('network:wireguard.addressesHint')}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={err('addresses')}
          />
          <TextField
            label={t('network:wireguard.mtu')}
            value={input.mtu}
            onChangeText={(mtu) => set({ mtu })}
            placeholder={t('network:wireguard.mtuHint')}
            keyboardType="number-pad"
            error={err('mtu')}
          />
        </GlassCard>
        <ListSection footer={iface ? undefined : t('network:wireguard.keysGenerated')}>
          <ListRow
            title={t('network:wireguard.joinLan')}
            subtitle={t('network:wireguard.joinLanHint')}
            switchValue={input.joinLan}
            onSwitch={(joinLan) => set({ joinLan })}
          />
          <ListRow
            title={t('network:wireguard.openPort')}
            subtitle={t('network:wireguard.openPortHint')}
            switchValue={input.openPort}
            onSwitch={(openPort) => set({ openPort })}
          />
        </ListSection>
        {errors.privateKey ? (
          <AppText variant="footnote" tone="danger">
            {t(`network:wireguard.error.${errors.privateKey}`)}
          </AppText>
        ) : null}
      </FormScreen>

      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending === 'delete' && iface
            ? t('network:wireguard.deleteTunnelTitle', { name: iface.name })
            : t('network:wireguard.confirmTitle')
        }
        consequences={[
          t('network:wireguard.consequence'),
          ...(pending === 'delete' ? [t('network:wireguard.deleteConsequence')] : []),
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
