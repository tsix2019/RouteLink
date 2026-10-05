import * as Clipboard from 'expo-clipboard';
import { StyleSheet, View } from 'react-native';

import { getWireGuard, peerConnected, type WgPeer } from '@/api/services/wireguard';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes, formatDuration } from '@/utils/format';

const shortKey = (key: string) => `${key.slice(0, 8)}…`;

/** NW-7: WireGuard interfaces and their peers (read-only; tunnels are set up in LuCI). */
export default function WireGuard() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const wg = useRouterQuery(['wireguard'], getWireGuard, { refetchInterval: 5_000 });
  // Handshake ages relative to when the router answered (render stays pure).
  const now = Math.floor(wg.dataUpdatedAt / 1000);

  const peerDetail = (p: WgPeer) =>
    [
      p.endpoint,
      p.latestHandshake
        ? peerConnected(p, now)
          ? t('network:wireguard.connected')
          : t('network:wireguard.handshake', { time: formatDuration(Math.max(0, now - p.latestHandshake), lang) })
        : t('network:wireguard.never'),
      p.rx || p.tx ? `↓ ${formatBytes(p.rx)} ↑ ${formatBytes(p.tx)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const copy = (key: string) => {
    void Clipboard.setStringAsync(key);
    toast(t('network:wireguard.copied'));
  };

  return (
    <Screen
      title={t('network:wireguard.title')}
      onRefresh={() => wg.refetch()}
      top={wg.data ? <ConnectionBanner error={wg.error} onRetry={() => void wg.refetch()} /> : null}>
      <FeatureGate feature="network.wireguard" icon="vpn">
        {wg.data ? (
          wg.data.length ? (
            wg.data.map((i) => (
              <View key={i.name} style={styles.group}>
                <ListSection title={i.name}>
                  <ListRow
                    title={t('network:wireguard.publicKey')}
                    value={shortKey(i.publicKey)}
                    icon="key"
                    onPress={i.publicKey ? () => copy(i.publicKey) : undefined}
                  />
                  {i.listenPort ? <ListRow title={t('network:wireguard.port')} value={String(i.listenPort)} /> : null}
                </ListSection>
                <ListSection title={t('network:wireguard.peers')}>
                  {i.peers.length ? (
                    i.peers.map((p) => (
                      <ListRow
                        key={p.publicKey}
                        title={p.name ?? t('network:wireguard.unnamed', { key: shortKey(p.publicKey) })}
                        subtitle={[peerDetail(p), p.allowedIps.join(', ')].filter(Boolean).join('\n')}
                        left={<StatusDot status={peerConnected(p, now) ? 'online' : 'offline'} />}
                        onLongPress={() => copy(p.publicKey)}
                      />
                    ))
                  ) : (
                    <ListRow title={t('network:wireguard.noPeers')} disabled />
                  )}
                </ListSection>
              </View>
            ))
          ) : (
            <EmptyState icon="vpn" title={t('network:wireguard.empty')} />
          )
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
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.s },
});
