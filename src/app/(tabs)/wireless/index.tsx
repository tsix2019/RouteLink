import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Client } from '@/api/services/clients';
import type { Radio } from '@/api/services/wireless';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { bandLabel, channelLabel, encryptionLabel, widthLabel } from '@/features/wireless/labels';
import { useClients, useRadios } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

/** Wi-Fi tab: one grouped section per radio — its settings row, then its networks. */
export default function Wireless() {
  const t = useT();
  const nav = useRouter();
  const radios = useRadios();
  const clients = useClients();
  const hasRadios = !!radios.data?.length;

  return (
    <Screen
      title={t('tabs.wireless')}
      headerLeft={<RouterSwitcherCapsule />}
      headerRight={
        hasRadios ? (
          <HeaderButton
            icon="scan"
            accessibilityLabel={t('wireless:scan')}
            onPress={() => nav.push('/wireless/scan')}
          />
        ) : undefined
      }
      onRefresh={() => radios.refetch()}
      top={
        radios.data ? (
          <ConnectionBanner
            error={radios.error}
            onRetry={() => void radios.refetch()}
            updatedAt={radios.dataUpdatedAt}
          />
        ) : null
      }>
      {radios.data ? (
        hasRadios ? (
          radios.data.map((radio) => <RadioSection key={radio.name} radio={radio} clients={clients.data ?? []} />)
        ) : (
          <EmptyState icon="wifiOff" title={t('wireless:noRadios')} message={t('wireless:noRadiosHint')} />
        )
      ) : radios.isError ? (
        <ErrorState error={radios.error} onRetry={() => void radios.refetch()} />
      ) : (
        <View style={styles.loading}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={52} radius={14} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function RadioSection({ radio, clients }: { radio: Radio; clients: Client[] }) {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const status = radio.disabled ? t('wireless:off') : radio.up ? undefined : t('wireless:down');
  return (
    <ListSection title={`${bandLabel(t, radio.band)} · ${radio.name}`}>
      <ListRow
        title={t('wireless:radioSettings')}
        subtitle={[channelLabel(t, radio.channel), widthLabel(radio.htmode)].join(' · ')}
        value={status}
        icon="antenna"
        chevron
        onPress={() => nav.push(`/wireless/radio/${encodeURIComponent(radio.name)}`)}
        testID={`radio-${radio.name}`}
      />
      {radio.networks.map((n) => {
        const count = clients.filter((c) => c.online && c.wifi && c.wifi.ifname === n.ifname).length;
        const details = [
          encryptionLabel(t, n.encryption),
          n.hidden ? t('wireless:hidden') : null,
          n.up ? t('wireless:clients', { count }) : n.disabled ? t('wireless:off') : t('wireless:down'),
        ].filter(Boolean);
        return (
          <ListRow
            key={n.section}
            title={n.ssid || n.section}
            subtitle={details.join(' · ')}
            icon={n.up ? 'wifi' : 'wifiOff'}
            iconColor={n.up ? colors.success : colors.textTertiary}
            chevron
            onPress={() => nav.push(`/wireless/network/${encodeURIComponent(n.section)}`)}
            testID={`wifi-${n.section}`}
          />
        );
      })}
      {radio.networks.length === 0 ? <ListRow title={t('wireless:noNetworks')} disabled /> : null}
    </ListSection>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
