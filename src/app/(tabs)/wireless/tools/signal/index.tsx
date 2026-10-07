import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GroupBanner } from '@/features/devices/GroupBanner';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { GradeBadge, mbps } from '@/features/wifi-tools/GradeBadge';
import {
  gradeCounts,
  signalHref,
  signalRows,
  sortSignalRows,
  type SignalRow,
  type SignalSort,
} from '@/features/wifi-tools/monitor';
import { usePhoneIp, usePollWhileFocused } from '@/features/wifi-tools/useGroupWifi';
import { bandLabel } from '@/features/wireless/labels';
import { useGroupClients } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Badge, SignalBars } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';

const SORTS: SignalSort[] = ['weakest', 'name'];

/** Signal monitor (design §17.1, WF-1): every wireless client of the group as its AP hears it. */
export default function SignalMonitor() {
  const t = useT();
  const nav = useRouter();
  const group = useGroupClients();
  // Without the plugin this is iwinfo's station list: refreshed every 2 seconds while the page is open.
  usePollWhileFocused(group.refetch, 2_000);
  const phoneIp = usePhoneIp();
  const [sort, setSort] = useState<SignalSort>('weakest');
  const rows = sortSignalRows(signalRows(group.data?.clients ?? [], phoneIp), sort);
  const counts = gradeCounts(rows);
  const weak = counts.fair + counts.poor;

  return (
    <Screen
      title={t('wifitools:signal.title')}
      onRefresh={() => group.refetch()}
      top={
        <>
          <ConnectionBanner error={group.data ? group.error : null} onRetry={() => void group.refetch()} />
          <GroupBanner />
        </>
      }>
      <Segmented
        values={SORTS.map((s) => t(`wifitools:signal.sort.${s}`))}
        selectedIndex={SORTS.indexOf(sort)}
        onChange={(e) => setSort(SORTS[e.nativeEvent.selectedSegmentIndex])}
      />
      {group.data ? (
        rows.length ? (
          <>
            <AppText variant="footnote" tone="secondary" style={styles.summary}>
              {weak
                ? t('wifitools:signal.summary', { count: rows.length, weak })
                : t('wifitools:signal.summaryGood', { count: rows.length })}
            </AppText>
            <ListSection footer={t('wifitools:signal.footer')}>
              {rows.map((r) => (
                <SignalListRow key={r.mac} row={r} onPress={() => nav.push(signalHref(r.mac, r.apId))} />
              ))}
            </ListSection>
          </>
        ) : (
          <EmptyState icon="wifi" title={t('wifitools:signal.empty')} />
        )
      ) : group.isError ? (
        <ErrorState error={group.error} onRetry={() => void group.refetch()} />
      ) : (
        <View style={styles.loading}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={52} radius={12} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function SignalListRow({ row, onPress }: { row: SignalRow; onPress(): void }) {
  const t = useT();
  return (
    <ListRow
      title={row.name}
      subtitle={[
        `${row.apName ?? row.ssid} · ${bandLabel(t, row.band)}`,
        t('wifitools:signal.rates', { down: mbps(row.txRate), up: mbps(row.rxRate) }),
        row.snr !== undefined ? t('wifitools:signal.snr', { value: row.snr }) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      left={
        <View style={styles.left}>
          <SignalBars dbm={row.signal} size={16} />
          <AppText variant="caption" tone="secondary">
            {row.signal}
          </AppText>
        </View>
      }
      right={
        <View style={styles.right}>
          {row.isPhone ? <Badge label={t('wifitools:tag.phone')} tone="accent" /> : null}
          <GradeBadge grade={row.grade} />
        </View>
      }
      chevron
      onPress={onPress}
      testID={`signal-${row.mac}`}
    />
  );
}

const styles = StyleSheet.create({
  summary: { marginLeft: spacing.l },
  loading: { gap: spacing.s },
  left: { width: 28, alignItems: 'center', gap: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
