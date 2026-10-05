import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import type { WifiNetwork } from '@/api/services/wireless';
import { QrCode } from '@/features/wireless/QrCode';
import { wifiQrString } from '@/features/wireless/wifiQr';
import { useRadios } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SheetScreen } from '@/ui/SheetScreen';
import { spacing } from '@/ui/theme/tokens';

/** OV-6 / WL-4: a Wi-Fi network as a QR code phones join from. `?section=` picks the network. */
export default function WifiQr() {
  const t = useT();
  const params = useLocalSearchParams<{ section?: string }>();
  const radios = useRadios();
  const [chosen, setChosen] = useState<string | undefined>(params.section);
  const [reveal, setReveal] = useState(false);

  // Access points only, one entry per SSID (2.4 and 5 GHz often share one).
  const networks: WifiNetwork[] = [];
  for (const r of radios.data ?? []) {
    for (const n of r.networks) {
      if (n.mode === 'ap' && !n.disabled && !networks.some((x) => x.ssid === n.ssid)) networks.push(n);
    }
  }
  const network = networks.find((n) => n.section === chosen) ?? (networks.length === 1 ? networks[0] : undefined);
  const open = network ? network.encryption === 'none' || network.encryption === 'owe' : false;

  return (
    <SheetScreen>
      <Screen title={t('wireless:qr.title')} inTabs={false}>
        {network ? (
          <>
            <GlassCard contentStyle={styles.card}>
              <AppText variant="title" align="center" numberOfLines={2}>
                {network.ssid}
              </AppText>
              <View style={styles.code}>
                <QrCode text={wifiQrString(network)} size={240} />
              </View>
              <AppText variant="footnote" tone="secondary" align="center">
                {open ? t('wireless:qr.open') : t('wireless:qr.hint')}
                {network.hidden ? ` ${t('wireless:qr.hidden')}` : ''}
              </AppText>
            </GlassCard>
            {!open && network.key ? (
              <ListSection>
                <ListRow
                  title={t('wireless:qr.password')}
                  value={reveal ? network.key : '••••••••'}
                  icon={reveal ? 'eyeOff' : 'eye'}
                  onPress={() => setReveal((v) => !v)}
                />
              </ListSection>
            ) : null}
            <GlassButton
              label={t('wireless:qr.share')}
              icon="share"
              onPress={() =>
                void Share.share({
                  message: open ? network.ssid : `${network.ssid}\n${t('wireless:qr.password')}: ${network.key ?? ''}`,
                })
              }
            />
            {networks.length > 1 ? (
              <ListSection title={t('wireless:qr.choose')}>
                {networks.map((n) => (
                  <ListRow
                    key={n.section}
                    title={n.ssid}
                    icon="wifi"
                    chevron={n.section !== network.section}
                    onPress={() => setChosen(n.section)}
                  />
                ))}
              </ListSection>
            ) : null}
          </>
        ) : networks.length ? (
          <ListSection title={t('wireless:qr.choose')}>
            {networks.map((n) => (
              <ListRow key={n.section} title={n.ssid} icon="wifi" chevron onPress={() => setChosen(n.section)} />
            ))}
          </ListSection>
        ) : (
          <EmptyState icon="wifiOff" title={radios.isLoading ? t('loading') : t('wireless:qr.none')} />
        )}
      </Screen>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: spacing.m, paddingVertical: spacing.l },
  code: { padding: spacing.s, backgroundColor: '#ffffff', borderRadius: 16 },
});
