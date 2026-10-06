import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isAvailable } from '@/api/capabilities';
import { getWireGuard, peerConnected, type WgInterface, type WgPeer } from '@/api/services/wireguard';
import {
  applyWgChanges,
  deletePeerChanges,
  getWgConfig,
  type WgConfigInterface,
  type WgConfigPeer,
} from '@/api/services/wireguard-config';
import type { UbusCall } from '@/api/ubus/types';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { wgExportHref } from '@/features/network/wireguardHrefs';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useCapabilities, useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes, formatDuration } from '@/utils/format';

const shortKey = (key: string) => `${key.slice(0, 8)}…`;

type Pending = { title: string; changes: UbusCall[] };

const ifaceHref = (name?: string) =>
  `/network/edit/wg-interface${name ? `?name=${encodeURIComponent(name)}` : ''}` as const;
const peerHref = (iface: string, section?: string) =>
  `/network/edit/wg-peer?iface=${encodeURIComponent(iface)}${section ? `&section=${encodeURIComponent(section)}` : ''}` as const;

/**
 * NW-7 / NW-8: WireGuard tunnels and peers — status here; tunnels and peers are edited on their own pages where
 * luci-proto-wireguard allows it.
 */
export default function WireGuard() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const nav = useRouter();
  const canEdit = isAvailable(useCapabilities().data, 'network.wireguard.config');
  const wg = useRouterQuery(['wireguard'], getWireGuard, { refetchInterval: 5_000 });
  const config = useRouterQuery(['wireguard-config'], getWgConfig, { enabled: canEdit });
  const [menu, setMenu] = useState<{ iface: WgConfigInterface; peer: WgConfigPeer } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const apply = useRouterMutation(
    (conn, changes: UbusCall[]) => applyWgChanges(conn, changes),
    [['wireguard'], ['wireguard-config'], ['firewall'], ['interfaces']],
  );
  // Handshake ages relative to when the router answered (render stays pure).
  const now = Math.floor(wg.dataUpdatedAt / 1000);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');

  const live = (iface: string, key: string): WgPeer | undefined =>
    wg.data?.find((i) => i.name === iface)?.peers.find((p) => p.publicKey === key);
  const peerDetail = (p: WgPeer | undefined) =>
    [
      p?.endpoint,
      p?.latestHandshake
        ? peerConnected(p, now)
          ? t('network:wireguard.connected')
          : t('network:wireguard.handshake', { time: formatDuration(Math.max(0, now - p.latestHandshake), lang) })
        : t('network:wireguard.never'),
      p && (p.rx || p.tx) ? `↓ ${formatBytes(p.rx)} ↑ ${formatBytes(p.tx)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const copy = (key: string) => {
    void Clipboard.setStringAsync(key);
    toast(t('network:wireguard.copied'));
  };

  const run = (p: Pending) =>
    apply.mutate(p.changes, {
      onSuccess: (outcome) =>
        outcome.status === 'rolled-back'
          ? toast(t('network:result.rolledBack'), 'warning')
          : toast(t('network:wireguard.applied')),
      onError: fail,
    });

  const interfaces = config.data?.interfaces;
  return (
    <>
      <Screen
        title={t('network:wireguard.title')}
        onRefresh={() => Promise.all([wg.refetch(), config.refetch()])}
        top={wg.data ? <ConnectionBanner error={wg.error} onRetry={() => void wg.refetch()} /> : null}>
        <FeatureGate feature="network.wireguard" icon="vpn">
          {canEdit && interfaces ? (
            <>
              {interfaces.map((iface) => (
                <View key={iface.name} style={styles.group}>
                  <ListSection title={iface.name}>
                    <ListRow
                      title={t('network:wireguard.publicKey')}
                      value={config.data!.publicKeys[iface.name] ? shortKey(config.data!.publicKeys[iface.name]) : '—'}
                      icon="key"
                      onPress={
                        config.data!.publicKeys[iface.name]
                          ? () => copy(config.data!.publicKeys[iface.name])
                          : undefined
                      }
                    />
                    <ListRow title={t('network:wireguard.port')} value={iface.listenPort ?? '—'} />
                    <ListRow title={t('network:wireguard.tunnelAddresses')} value={iface.addresses.join(', ') || '—'} />
                    <ListRow title={t('network:wireguard.zone')} value={iface.zone ?? t('network:wireguard.noZone')} />
                    <ListRow
                      title={t('network:wireguard.editTunnel')}
                      icon="edit"
                      chevron
                      onPress={() => nav.push(ifaceHref(iface.name))}
                      testID={`wg-iface-${iface.name}`}
                    />
                  </ListSection>
                  <ListSection title={t('network:wireguard.peers')}>
                    {iface.peers.length ? (
                      iface.peers.map((p) => {
                        const state = live(iface.name, p.publicKey);
                        return (
                          <ListRow
                            key={p.section}
                            title={p.name || t('network:wireguard.unnamed', { key: shortKey(p.publicKey) })}
                            subtitle={[peerDetail(state), p.allowedIps.join(', ')].filter(Boolean).join('\n')}
                            left={<StatusDot status={state && peerConnected(state, now) ? 'online' : 'offline'} />}
                            chevron
                            onPress={() => setMenu({ iface, peer: p })}
                            onLongPress={() => copy(p.publicKey)}
                            testID={`wg-peer-${p.section}`}
                          />
                        );
                      })
                    ) : (
                      <ListRow title={t('network:wireguard.noPeers')} disabled />
                    )}
                  </ListSection>
                  <GlassButton
                    label={t('network:wireguard.addPeer')}
                    icon="plus"
                    disabled={apply.isPending}
                    onPress={() => nav.push(peerHref(iface.name))}
                    testID={`wg-add-peer-${iface.name}`}
                  />
                </View>
              ))}
              {!interfaces.length ? <EmptyState icon="vpn" title={t('network:wireguard.empty')} /> : null}
              <GlassButton
                label={t('network:wireguard.newTunnel')}
                icon="plus"
                variant={interfaces.length ? 'glass' : 'primary'}
                disabled={apply.isPending}
                onPress={() => nav.push(ifaceHref())}
                testID="wg-new-tunnel"
              />
            </>
          ) : wg.data ? (
            <StatusOnly interfaces={wg.data} now={now} detail={peerDetail} onCopy={copy} />
          ) : wg.isError ? (
            <ErrorState error={wg.error} onRetry={() => void wg.refetch()} />
          ) : (
            <View style={styles.group}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!menu}
        title={menu ? menu.peer.name || shortKey(menu.peer.publicKey) : undefined}
        message={menu && !menu.peer.privateKey ? t('network:wireguard.noExport') : undefined}
        actions={
          !menu
            ? []
            : [
                {
                  label: t('network:wireguard.exportPeer'),
                  icon: 'qrcode' as const,
                  disabled: !menu.peer.privateKey,
                  onPress: () => {
                    setMenu(null);
                    nav.push(wgExportHref(menu.iface.name, menu.peer.publicKey));
                  },
                },
                {
                  label: t('network:wireguard.editPeer'),
                  icon: 'edit' as const,
                  onPress: () => {
                    setMenu(null);
                    nav.push(peerHref(menu.iface.name, menu.peer.section));
                  },
                },
                {
                  label: t('network:wireguard.deletePeer'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    const { peer } = menu;
                    setMenu(null);
                    setPending({
                      title: t('network:wireguard.deletePeerTitle', { name: peer.name || shortKey(peer.publicKey) }),
                      changes: deletePeerChanges(peer),
                    });
                  },
                },
              ]
        }
        onCancel={() => setMenu(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={[t('network:wireguard.consequence'), t('network:wireguard.deleteConsequence')]}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) run(p);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

/** Routers without luci-proto-wireguard's key helpers: the M2 status view. */
function StatusOnly({
  interfaces,
  now,
  detail,
  onCopy,
}: {
  interfaces: WgInterface[];
  now: number;
  detail(p: WgPeer): string;
  onCopy(key: string): void;
}) {
  const t = useT();
  if (!interfaces.length) return <EmptyState icon="vpn" title={t('network:wireguard.empty')} />;
  return interfaces.map((i) => (
    <View key={i.name} style={styles.group}>
      <ListSection title={i.name}>
        <ListRow
          title={t('network:wireguard.publicKey')}
          value={shortKey(i.publicKey)}
          icon="key"
          onPress={i.publicKey ? () => onCopy(i.publicKey) : undefined}
        />
        {i.listenPort ? <ListRow title={t('network:wireguard.port')} value={String(i.listenPort)} /> : null}
      </ListSection>
      <ListSection title={t('network:wireguard.peers')}>
        {i.peers.length ? (
          i.peers.map((p) => (
            <ListRow
              key={p.publicKey}
              title={p.name ?? t('network:wireguard.unnamed', { key: shortKey(p.publicKey) })}
              subtitle={[detail(p), p.allowedIps.join(', ')].filter(Boolean).join('\n')}
              left={<StatusDot status={peerConnected(p, now) ? 'online' : 'offline'} />}
              onLongPress={() => onCopy(p.publicKey)}
            />
          ))
        ) : (
          <ListRow title={t('network:wireguard.noPeers')} disabled />
        )}
      </ListSection>
    </View>
  ));
}

const styles = StyleSheet.create({
  group: { gap: spacing.s },
});
