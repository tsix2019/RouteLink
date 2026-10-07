import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isAvailable } from '@/api/capabilities';
import { getDdns } from '@/api/services/ddns';
import { pickWan } from '@/api/services/network';
import { clientConfig, getWgConfig, publicKeyOf } from '@/api/services/wireguard-config';
import { QrCode } from '@/features/wireless/QrCode';
import { useCapabilities, useInterfaces, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { TextField } from '@/ui/TextField';
import { MONO_FONT, spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { isPrivateIPv4 } from '@/utils/net';

type Endpoint = 'ddns' | 'wan' | 'custom';
type Traffic = 'all' | 'lan';

/** NW-8: a peer's wg-quick config as a QR code and a file. `?iface=` and `?key=` (its public key) pick the peer. */
export default function WireGuardExport() {
  const t = useT();
  const toast = useToast();
  const params = useLocalSearchParams<{ iface: string; key: string }>();
  const caps = useCapabilities().data;
  const config = useRouterQuery(['wireguard-config'], getWgConfig);
  const interfaces = useInterfaces().data ?? [];
  const ddns = useRouterQuery(['ddns'], getDdns, { enabled: isAvailable(caps, 'network.ddns') });
  const iface = config.data?.interfaces.find((i) => i.name === params.iface);
  const peer = iface?.peers.find((p) => p.publicKey === params.key);
  const livePub = iface ? config.data?.publicKeys[iface.name] : undefined;
  // A tunnel that is not up yet has no key in `wg show`: derive it from the private key.
  const derived = useRouterQuery(['wireguard-pub', iface?.name], (conn) => publicKeyOf(conn, iface!.privateKey), {
    enabled: !!iface && !livePub && !!iface.privateKey,
  });
  const serverKey = livePub ?? derived.data;

  const ddnsHost = ddns.data?.services.find((s) => s.enabled && s.domain)?.domain.replace('@', '.');
  const wanIp = pickWan(interfaces)?.ipv4[0]?.address;
  const lan = interfaces.find((i) => i.name === 'lan')?.ipv4[0];
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [custom, setCustom] = useState('');
  const [traffic, setTraffic] = useState<Traffic>('all');
  const choice: Endpoint = endpoint ?? (ddnsHost ? 'ddns' : wanIp && !isPrivateIPv4(wanIp) ? 'wan' : 'custom');
  const host = choice === 'ddns' ? ddnsHost : choice === 'wan' ? wanIp : custom.trim();
  const options: Endpoint[] = [
    ...(ddnsHost ? (['ddns'] as const) : []),
    ...(wanIp ? (['wan'] as const) : []),
    'custom',
  ];

  const lanNet = lan ? `${networkOf(lan.address, lan.mask)}/${lan.mask}` : undefined;
  const tunnelNets = iface?.addresses
    .filter((a) => a.includes('.'))
    .map((a) => {
      const [ip, mask] = a.split('/');
      return `${networkOf(ip, Number(mask))}/${mask}`;
    });
  const text =
    iface && peer?.privateKey && serverKey && host
      ? clientConfig(iface, peer, {
          serverPublicKey: serverKey,
          endpoint: host,
          dns: lan ? [lan.address] : [],
          allowedIps:
            traffic === 'all' ? ['0.0.0.0/0', '::/0'] : [lanNet, ...(tunnelNets ?? [])].filter((x): x is string => !!x),
        })
      : null;

  const share = async () => {
    if (!text || !peer) return;
    try {
      const name = `${(peer.name || iface!.name).replace(/[^\w-]+/g, '_')}.conf`;
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: t('network:wireguard.export.share') });
    } catch (e) {
      toast(describeError(t, e).title, 'error');
    }
  };

  return (
    <Screen title={peer?.name || t('network:wireguard.export.title')}>
      {!config.data ? (
        <Skeleton height={280} radius={22} />
      ) : !peer || !iface ? (
        <EmptyState icon="vpn" title={t('network:wireguard.noExport')} />
      ) : !peer.privateKey ? (
        <EmptyState icon="vpn" title={t('network:wireguard.noExport')} />
      ) : (
        <>
          <GlassCard contentStyle={styles.card}>
            {text ? (
              <View style={styles.code}>
                <QrCode text={text} size={260} />
              </View>
            ) : (
              <AppText variant="body" tone="secondary" align="center">
                {t('network:wireguard.export.noEndpoint')}
              </AppText>
            )}
            <AppText variant="footnote" tone="secondary" align="center">
              {t('network:wireguard.export.hint')}
            </AppText>
          </GlassCard>
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('network:wireguard.export.endpoint')}
          </AppText>
          <Segmented
            values={options.map((o) =>
              o === 'ddns'
                ? t('network:wireguard.export.endpointDdns')
                : o === 'wan'
                  ? t('network:wireguard.export.endpointWan')
                  : t('network:wireguard.export.endpointCustom'),
            )}
            selectedIndex={Math.max(0, options.indexOf(choice))}
            onChange={(e) => setEndpoint(options[e.nativeEvent.selectedSegmentIndex])}
          />
          {choice === 'custom' ? (
            <TextField
              label={t('network:wireguard.export.endpoint')}
              value={custom}
              onChangeText={setCustom}
              placeholder={t('network:wireguard.export.endpointPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              monospace
            />
          ) : (
            <ListSection>
              <ListRow title={host ?? '—'} />
            </ListSection>
          )}
          {choice === 'wan' && wanIp && isPrivateIPv4(wanIp) ? (
            <AppText variant="footnote" tone="warning" style={styles.note}>
              {t('network:wireguard.export.privateWan', { ip: wanIp })}
            </AppText>
          ) : null}
          <AppText variant="footnote" tone="secondary" style={styles.note}>
            {t('network:wireguard.export.traffic')}
          </AppText>
          <Segmented
            values={[t('network:wireguard.export.trafficAll'), t('network:wireguard.export.trafficLan')]}
            selectedIndex={traffic === 'all' ? 0 : 1}
            onChange={(e) => setTraffic(e.nativeEvent.selectedSegmentIndex === 0 ? 'all' : 'lan')}
          />
          {text ? (
            <>
              <GlassCard>
                <AppText variant="footnote" selectable style={styles.mono}>
                  {text}
                </AppText>
              </GlassCard>
              <GlassButton
                label={t('network:wireguard.export.copy')}
                icon="copy"
                onPress={() => {
                  void Clipboard.setStringAsync(text);
                  toast(t('network:wireguard.export.copied'));
                }}
              />
              <GlassButton
                label={t('network:wireguard.export.share')}
                icon="share"
                variant="primary"
                onPress={() => void share()}
              />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function networkOf(ip: string, prefix: number): string {
  const n = ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (n & mask) >>> 0;
  return [24, 16, 8, 0].map((s) => (net >>> s) & 255).join('.');
}

const styles = StyleSheet.create({
  card: { gap: spacing.m, alignItems: 'center' },
  code: { padding: spacing.m, backgroundColor: '#FFFFFF', borderRadius: 16 },
  note: { paddingHorizontal: spacing.l },
  mono: { fontFamily: MONO_FONT },
});
