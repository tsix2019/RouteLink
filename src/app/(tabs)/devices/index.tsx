import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { DeviceRow } from '@/features/devices/DeviceRow';
import { filterClients, type LinkFilter, type StatusFilter } from '@/features/devices/filter';
import { GroupBanner } from '@/features/devices/GroupBanner';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { useClients } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { Segmented } from '@/ui/Segmented';

export default function Devices() {
  const t = useT();
  const nav = useRouter();
  const clients = useClients();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [link, setLink] = useState<LinkFilter>('all');
  const all = clients.data ?? [];
  const shown = filterClients(all, query, status, link);
  const statusValues: StatusFilter[] = ['all', 'online', 'offline'];
  const linkValues: LinkFilter[] = ['all', 'wifi', 'wired'];

  return (
    <>
      {Platform.OS === 'ios' ? (
        <Stack.Screen
          options={{
            headerSearchBarOptions: {
              placeholder: t('devices:search'),
              onChangeText: (e) => setQuery(e.nativeEvent.text),
              hideWhenScrolling: false,
            },
          }}
        />
      ) : null}
      <Screen
        title={t('tabs.devices')}
        headerLeft={<RouterSwitcherCapsule />}
        headerRight={
          <HeaderButton
            icon="shield"
            accessibilityLabel={t('devices:intruders')}
            onPress={() => nav.push('/devices/intruders')}
            testID="devices-intruders"
          />
        }
        onRefresh={() => clients.refetch()}
        top={
          <>
            <ConnectionBanner error={clients.data ? clients.error : null} onRetry={() => void clients.refetch()} />
            <GroupBanner />
          </>
        }>
        {Platform.OS === 'android' ? (
          <TextField placeholder={t('devices:search')} value={query} onChangeText={setQuery} />
        ) : null}
        <View style={styles.filters}>
          <Segmented
            values={statusValues.map((v) => t(`devices:filter.${v}`))}
            selectedIndex={statusValues.indexOf(status)}
            onChange={(e) => setStatus(statusValues[e.nativeEvent.selectedSegmentIndex])}
          />
          <Segmented
            values={linkValues.map((v) => t(`devices:filter.${v}`))}
            selectedIndex={linkValues.indexOf(link)}
            onChange={(e) => setLink(linkValues[e.nativeEvent.selectedSegmentIndex])}
          />
        </View>
        {clients.data ? (
          <>
            <AppText variant="footnote" tone="secondary" style={styles.summary}>
              {t('devices:summary', { online: all.filter((c) => c.online).length, total: all.length })}
            </AppText>
            {shown.length ? (
              <ListSection>
                {shown.map((c) => (
                  <DeviceRow key={c.mac} client={c} />
                ))}
              </ListSection>
            ) : (
              <EmptyState icon="search" title={t('devices:empty')} />
            )}
          </>
        ) : clients.isError ? (
          <ErrorState error={clients.error} onRetry={() => void clients.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} radius={12} />
            ))}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  filters: { gap: spacing.s },
  summary: { marginLeft: spacing.l },
  loading: { gap: spacing.s },
});
