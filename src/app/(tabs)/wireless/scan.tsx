import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { scan, type ScanResult } from '@/api/services/wireless';
import { bandLabel } from '@/features/wireless/labels';
import { useRadios, useRouterMutation } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SignalBars } from '@/ui/Status';
import { describeError } from '@/ui/errorText';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { Segmented } from '@/ui/Segmented';

/** Nearby networks as seen by one of the router's radios (iwinfo scan), strongest first. */
export default function WirelessScan() {
  const t = useT();
  const toast = useToast();
  const radios = (useRadios().data ?? []).filter((r) => r.up && r.networks.some((n) => n.ifname));
  const [index, setIndex] = useState(0);
  const radio = radios[Math.min(index, radios.length - 1)];
  const ifname = radio?.networks.find((n) => n.ifname)?.ifname;
  const [results, setResults] = useState<Record<string, ScanResult[]>>({});
  const run = useRouterMutation((conn, device: string) => scan(conn, device), []);

  const start = () => {
    if (!ifname) return;
    run.mutate(ifname, {
      onSuccess: (list) => setResults((r) => ({ ...r, [ifname]: list })),
      onError: (error) => toast(describeError(t, error).title, 'error'),
    });
  };
  const list = ifname ? results[ifname] : undefined;

  return (
    <Screen title={t('wireless:scanTitle')} inTabs>
      {radios.length > 1 ? (
        <Segmented
          values={radios.map((r) => bandLabel(t, r.band))}
          selectedIndex={Math.min(index, radios.length - 1)}
          onChange={(e) => setIndex(e.nativeEvent.selectedSegmentIndex)}
        />
      ) : null}
      <View style={styles.actions}>
        <GlassButton
          label={run.isPending ? t('wireless:scanning') : t('wireless:scanStart')}
          icon="scan"
          variant="primary"
          loading={run.isPending}
          disabled={run.isPending || !ifname}
          onPress={start}
          testID="scan-start"
        />
        <AppText variant="footnote" tone="secondary" align="center">
          {t('wireless:scanHint')}
        </AppText>
      </View>
      {list ? (
        list.length ? (
          <ListSection title={t('wireless:scanCount', { count: list.length })}>
            {list.map((n) => (
              <ListRow
                key={`${n.bssid}-${n.channel}`}
                title={n.ssid || t('wireless:hiddenNetwork')}
                subtitle={[n.bssid, t('wireless:channelValue', { channel: n.channel }), n.encryption].join(' · ')}
                right={
                  <View style={styles.signal}>
                    <AppText variant="footnote" tone="secondary">
                      {`${n.signal} dBm`}
                    </AppText>
                    <SignalBars dbm={n.signal} />
                  </View>
                }
              />
            ))}
          </ListSection>
        ) : (
          <EmptyState icon="wifiOff" title={t('wireless:scanEmpty')} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.s },
  signal: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
});
