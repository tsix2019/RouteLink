import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  applyWgChanges,
  deletePeerChanges,
  getWgConfig,
  nextPeerAddress,
  peerChanges,
  validatePeer,
  type WgConfigInterface,
  type WgConfigPeer,
  type WgPeerInput,
} from '@/api/services/wireguard-config';
import type { UbusCall } from '@/api/ubus/types';
import { useWgKeys } from '@/features/network/useWgKeys';
import { wgExportHref } from '@/features/network/wireguardHrefs';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { differs, FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Segmented } from '@/ui/Segmented';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const shortKey = (key: string) => `${key.slice(0, 8)}…`;

/**
 * NW-8: add a peer to `?iface=`, or edit `&section=`. New peers get router-made keys by default (exportable);
 * "Peer's public key" takes a key from a device that made its own.
 */
export default function EditWgPeer() {
  const t = useT();
  const params = useLocalSearchParams<{ iface: string; section?: string }>();
  const config = useRouterQuery(['wireguard-config'], getWgConfig);
  const keys = useWgKeys({ pair: !params.section, psk: true });
  const iface = useLoaded(config.data?.interfaces.find((i) => i.name === params.iface));
  const peer = useLoaded(params.section ? iface?.peers.find((p) => p.section === params.section) : undefined);
  const title = params.section ? t('network:wireguard.editPeer') : t('network:wireguard.addPeer');
  const missing = !!config.data && (!iface || (!!params.section && !peer));
  if (!config.data || !iface || (params.section && !peer) || !keys.data) {
    return (
      <FormPlaceholder
        title={title}
        error={missing ? undefined : (config.error ?? keys.error)}
        onRetry={() => void Promise.all([config.refetch(), keys.refetch()])}
        missing={missing}
      />
    );
  }
  return <PeerForm title={title} iface={iface} peer={peer} keys={keys.data} />;
}

function PeerForm({
  title,
  iface,
  peer,
  keys,
}: {
  title: string;
  iface: WgConfigInterface;
  peer?: WgConfigPeer;
  keys: { pair: { privateKey: string; publicKey: string } | null; psk: string };
}) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  const [initial] = useState<WgPeerInput>(() =>
    peer
      ? {
          name: peer.name,
          publicKey: peer.publicKey,
          privateKey: peer.privateKey ?? '',
          presharedKey: peer.presharedKey ?? '',
          allowedIps: peer.allowedIps.join(' '),
          endpointHost: peer.endpointHost ?? '',
          endpointPort: peer.endpointPort ?? '',
          keepalive: peer.keepalive ?? '',
          routeAllowedIps: peer.routeAllowedIps,
        }
      : {
          name: '',
          publicKey: keys.pair?.publicKey ?? '',
          privateKey: keys.pair?.privateKey ?? '',
          presharedKey: '',
          allowedIps: nextPeerAddress(iface) ?? '',
          endpointHost: '',
          endpointPort: '',
          keepalive: '25',
          routeAllowedIps: false,
        },
  );
  const [input, setInput] = useState(initial);
  const [own, setOwn] = useState(!initial.privateKey);
  const [advanced, setAdvanced] = useState(!!(initial.endpointHost || initial.routeAllowedIps));
  const [errors, setErrors] = useState<ReturnType<typeof validatePeer>>({});
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const apply = useRouterMutation(
    (conn, changes: UbusCall[]) => applyWgChanges(conn, changes),
    [['wireguard'], ['wireguard-config'], ['firewall'], ['interfaces']],
  );

  const set = (patch: Partial<WgPeerInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setErrors({});
  };
  const err = (key: keyof WgPeerInput) => (errors[key] ? t(`network:wireguard.error.${errors[key]!}`) : undefined);
  const psk = initial.presharedKey || keys.psk;
  const chooseOwnKey = (value: boolean) => {
    setOwn(value);
    set(value ? { privateKey: '', publicKey: '' } : { privateKey: initial.privateKey, publicKey: initial.publicKey });
  };

  const submit = () => {
    const found = validatePeer(input, iface, peer?.section);
    setErrors(found);
    if (!Object.keys(found).length) setPending('save');
  };
  const run = () => {
    const kind = pending;
    setPending(null);
    const changes = kind === 'delete' && peer ? deletePeerChanges(peer) : peerChanges(iface, input, peer);
    // A new peer with router-made keys: show its config once it is saved.
    const exportAfter = kind === 'save' && !peer && input.privateKey;
    apply.mutate(changes, {
      onSuccess: (outcome) => {
        if (outcome.status === 'rolled-back') {
          toast(t('network:result.rolledBack'), 'warning');
          return;
        }
        toast(t('network:wireguard.applied'));
        if (exportAfter) exit.replace(wgExportHref(iface.name, input.publicKey));
        else exit.back();
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
        onDelete={peer ? () => setPending('delete') : undefined}
        deleteLabel={t('network:wireguard.deletePeer')}
        testID="wg-peer-form">
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('network:wireguard.peerName')}
            value={input.name}
            onChangeText={(name) => set({ name })}
            placeholder={t('network:wireguard.peerNamePlaceholder')}
            error={err('name')}
          />
          {initial.privateKey ? (
            <Segmented
              values={[t('network:wireguard.keyGenerated'), t('network:wireguard.keyOwn')]}
              selectedIndex={own ? 1 : 0}
              onChange={(e) => chooseOwnKey(e.nativeEvent.selectedSegmentIndex === 1)}
            />
          ) : null}
          {own ? (
            <TextField
              label={t('network:wireguard.publicKeyField')}
              value={input.publicKey}
              onChangeText={(publicKey) => set({ publicKey: publicKey.trim() })}
              hint={t('network:wireguard.ownKeyHint')}
              autoCapitalize="none"
              autoCorrect={false}
              monospace
              error={err('publicKey')}
              testID="wg-peer-key"
            />
          ) : (
            <AppText variant="footnote" tone="secondary">
              {t('network:wireguard.generatedKeyHint')}
            </AppText>
          )}
          <TextField
            label={t('network:wireguard.allowedIps')}
            value={input.allowedIps}
            onChangeText={(allowedIps) => set({ allowedIps })}
            hint={t('network:wireguard.allowedIpsHint')}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={err('allowedIps')}
          />
          <TextField
            label={t('network:wireguard.keepalive')}
            value={input.keepalive}
            onChangeText={(keepalive) => set({ keepalive })}
            keyboardType="number-pad"
            error={err('keepalive')}
          />
        </GlassCard>
        <ListSection>
          <ListRow
            title={t('network:wireguard.psk')}
            switchValue={!!input.presharedKey}
            onSwitch={(on) => set({ presharedKey: on ? psk : '' })}
            disabled={!psk}
          />
          <ListRow title={t('network:wireguard.advanced')} switchValue={advanced} onSwitch={setAdvanced} />
        </ListSection>
        {advanced ? (
          <>
            <GlassCard contentStyle={styles.card}>
              <TextField
                label={t('network:wireguard.endpointHost')}
                value={input.endpointHost}
                onChangeText={(endpointHost) => set({ endpointHost })}
                autoCapitalize="none"
                autoCorrect={false}
                monospace
              />
              <TextField
                label={t('network:wireguard.endpointPort')}
                value={input.endpointPort}
                onChangeText={(endpointPort) => set({ endpointPort })}
                keyboardType="number-pad"
                error={err('endpointPort')}
              />
            </GlassCard>
            <ListSection>
              <ListRow
                title={t('network:wireguard.routeAllowedIps')}
                switchValue={input.routeAllowedIps}
                onSwitch={(routeAllowedIps) => set({ routeAllowedIps })}
              />
            </ListSection>
          </>
        ) : null}
      </FormScreen>

      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending === 'delete' && peer
            ? t('network:wireguard.deletePeerTitle', { name: peer.name || shortKey(peer.publicKey) })
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
