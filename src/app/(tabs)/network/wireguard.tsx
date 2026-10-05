import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isAvailable } from '@/api/capabilities';
import { getWireGuard, peerConnected, type WgInterface, type WgPeer } from '@/api/services/wireguard';
import {
  applyWgChanges,
  createInterfaceChanges,
  deleteInterfaceChanges,
  deletePeerChanges,
  editInterfaceChanges,
  generateKeyPair,
  generatePsk,
  getWgConfig,
  nextPeerAddress,
  peerChanges,
  suggestInterface,
  type WgConfigInterface,
  type WgConfigPeer,
  type WgInterfaceInput,
  type WgPeerInput,
} from '@/api/services/wireguard-config';
import type { UbusCall } from '@/api/ubus/types';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { WgInterfaceSheet } from '@/features/network/WgInterfaceSheet';
import { WgPeerSheet } from '@/features/network/WgPeerSheet';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
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

type Sheet =
  | { kind: 'iface'; input: WgInterfaceInput; editing?: WgConfigInterface }
  | { kind: 'peer'; iface: WgConfigInterface; input: WgPeerInput; psk?: string; editing?: WgConfigPeer };
type Pending = {
  title: string;
  changes: UbusCall[];
  destructive?: boolean;
  /** A new peer with router-made keys: open its export once it is saved. */
  exportKey?: { iface: string; publicKey: string };
};

/** NW-7 / NW-8: WireGuard tunnels and peers — status, and editing where luci-proto-wireguard allows it. */
export default function WireGuard() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const nav = useRouter();
  const { connection } = useActiveRouter();
  const canEdit = isAvailable(useCapabilities().data, 'network.wireguard.config');
  const wg = useRouterQuery(['wireguard'], getWireGuard, { refetchInterval: 5_000 });
  const config = useRouterQuery(['wireguard-config'], getWgConfig, { enabled: canEdit });
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<{ iface: WgConfigInterface; peer?: WgConfigPeer } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
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

  /** Keys come from the router before a form opens, so Save only has to stage uci changes. */
  const withKeys = async (open: (keys: { privateKey: string; publicKey: string }, psk: string) => void) => {
    if (!connection) return;
    setBusy(true);
    try {
      const keys = await generateKeyPair(connection);
      open(keys, await generatePsk(connection));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const newTunnel = () =>
    withKeys((keys) => {
      const s = suggestInterface(config.data!.interfaces, config.data!.network);
      setSheet({ kind: 'iface', input: { ...s, privateKey: keys.privateKey, mtu: '', joinLan: true, openPort: true } });
    });
  const newPeer = (iface: WgConfigInterface) =>
    withKeys((keys, psk) =>
      setSheet({
        kind: 'peer',
        iface,
        psk,
        input: {
          name: '',
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          presharedKey: '',
          allowedIps: nextPeerAddress(iface) ?? '',
          endpointHost: '',
          endpointPort: '',
          keepalive: '25',
          routeAllowedIps: false,
        },
      }),
    );
  const editPeer = (iface: WgConfigInterface, peer: WgConfigPeer) =>
    withKeys((_keys, psk) =>
      setSheet({
        kind: 'peer',
        iface,
        editing: peer,
        psk,
        input: {
          name: peer.name,
          publicKey: peer.publicKey,
          privateKey: peer.privateKey ?? '',
          presharedKey: peer.presharedKey ?? '',
          allowedIps: peer.allowedIps.join(' '),
          endpointHost: peer.endpointHost ?? '',
          endpointPort: peer.endpointPort ?? '',
          keepalive: peer.keepalive ?? '',
          routeAllowedIps: peer.routeAllowedIps,
        },
      }),
    );

  const run = (p: Pending) =>
    apply.mutate(p.changes, {
      onSuccess: (outcome) => {
        if (outcome.status === 'rolled-back') {
          toast(t('network:result.rolledBack'), 'warning');
          return;
        }
        toast(t('network:wireguard.applied'));
        if (p.exportKey) {
          nav.push(
            `/wireguard-export?iface=${encodeURIComponent(p.exportKey.iface)}&key=${encodeURIComponent(p.exportKey.publicKey)}`,
          );
        }
      },
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
                      onPress={() => setMenu({ iface })}
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
                    disabled={busy || apply.isPending}
                    loading={busy}
                    onPress={() => void newPeer(iface)}
                    testID={`wg-add-peer-${iface.name}`}
                  />
                </View>
              ))}
              {!interfaces.length ? <EmptyState icon="vpn" title={t('network:wireguard.empty')} /> : null}
              <GlassButton
                label={t('network:wireguard.newTunnel')}
                icon="plus"
                variant={interfaces.length ? 'glass' : 'primary'}
                disabled={busy || apply.isPending}
                onPress={() => void newTunnel()}
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
        title={menu?.peer ? menu.peer.name || shortKey(menu.peer.publicKey) : menu?.iface.name}
        message={menu?.peer && !menu.peer.privateKey ? t('network:wireguard.noExport') : undefined}
        actions={
          !menu
            ? []
            : menu.peer
              ? [
                  {
                    label: t('network:wireguard.exportPeer'),
                    icon: 'qrcode' as const,
                    disabled: !menu.peer.privateKey,
                    onPress: () => {
                      const { iface, peer } = menu;
                      setMenu(null);
                      nav.push(
                        `/wireguard-export?iface=${encodeURIComponent(iface.name)}&key=${encodeURIComponent(peer!.publicKey)}`,
                      );
                    },
                  },
                  {
                    label: t('network:wireguard.editPeer'),
                    icon: 'edit' as const,
                    onPress: () => {
                      const { iface, peer } = menu;
                      setMenu(null);
                      void editPeer(iface, peer!);
                    },
                  },
                  {
                    label: t('network:wireguard.deletePeer'),
                    icon: 'trash' as const,
                    destructive: true,
                    onPress: () => {
                      const peer = menu.peer!;
                      setMenu(null);
                      setPending({
                        title: t('network:wireguard.deletePeerTitle', { name: peer.name || shortKey(peer.publicKey) }),
                        changes: deletePeerChanges(peer),
                        destructive: true,
                      });
                    },
                  },
                ]
              : [
                  {
                    label: t('network:wireguard.editTunnel'),
                    icon: 'edit' as const,
                    onPress: () => {
                      const { iface } = menu;
                      setMenu(null);
                      setSheet({
                        kind: 'iface',
                        editing: iface,
                        input: {
                          name: iface.name,
                          privateKey: iface.privateKey,
                          listenPort: iface.listenPort ?? '',
                          addresses: iface.addresses.join(' '),
                          mtu: iface.mtu ?? '',
                          joinLan: iface.zone === 'lan',
                          openPort: !!iface.portRule,
                        },
                      });
                    },
                  },
                  {
                    label: t('network:wireguard.deleteTunnel'),
                    icon: 'trash' as const,
                    destructive: true,
                    onPress: () => {
                      const { iface } = menu;
                      setMenu(null);
                      setPending({
                        title: t('network:wireguard.deleteTunnelTitle', { name: iface.name }),
                        changes: deleteInterfaceChanges(iface, config.data!.firewall),
                        destructive: true,
                      });
                    },
                  },
                ]
        }
        onCancel={() => setMenu(null)}
      />
      {sheet?.kind === 'iface' && config.data ? (
        <WgInterfaceSheet
          initial={sheet.input}
          editing={sheet.editing}
          interfaces={config.data.interfaces}
          network={config.data.network}
          onCancel={() => setSheet(null)}
          onSave={(input) => {
            setSheet(null);
            setPending({
              title: t('network:wireguard.confirmTitle'),
              changes: sheet.editing
                ? editInterfaceChanges(sheet.editing, input, config.data!.firewall)
                : createInterfaceChanges(input, config.data!.firewall),
            });
          }}
        />
      ) : null}
      {sheet?.kind === 'peer' ? (
        <WgPeerSheet
          iface={sheet.iface}
          initial={sheet.input}
          pskCandidate={sheet.psk}
          editing={sheet.editing}
          onCancel={() => setSheet(null)}
          onDelete={
            sheet.editing
              ? () => {
                  const peer = sheet.editing!;
                  setSheet(null);
                  setPending({
                    title: t('network:wireguard.deletePeerTitle', { name: peer.name || shortKey(peer.publicKey) }),
                    changes: deletePeerChanges(peer),
                    destructive: true,
                  });
                }
              : undefined
          }
          onSave={(input) => {
            const { iface, editing } = sheet;
            setSheet(null);
            setPending({
              title: t('network:wireguard.confirmTitle'),
              changes: peerChanges(iface, input, editing),
              exportKey: !editing && input.privateKey ? { iface: iface.name, publicKey: input.publicKey } : undefined,
            });
          }}
        />
      ) : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={[
          t('network:wireguard.consequence'),
          ...(pending?.destructive ? [t('network:wireguard.deleteConsequence')] : []),
        ]}
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
