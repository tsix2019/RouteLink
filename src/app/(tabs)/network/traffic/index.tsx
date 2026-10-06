import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { agentSummary, type AgentInfo, type TrafficClass } from '@/api/services/agent';
import { AgentBanner } from '@/features/agent/AgentBanner';
import { AGENT_PAGE, AgentGate } from '@/features/agent/AgentGate';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { historyCsv, summaryCsv } from '@/features/traffic/csv';
import { DeviceTrafficRow, LiveTrafficRow } from '@/features/traffic/DeviceTrafficRow';
import { useDeviceLabels } from '@/features/traffic/labels';
import { csvFileName, shareCsv } from '@/features/traffic/share';
import { TimeRangePicker } from '@/features/traffic/TimeRangePicker';
import {
  DEFAULT_RANGE,
  parseRange,
  rangeLabel,
  resolveRange,
  serializeRange,
  usableHoursMask,
  type TimeRange,
} from '@/features/traffic/timeRange';
import { useAgentStatus, useLiveTraffic, useTrafficHistory, useTrafficSummary } from '@/hooks/agent-queries';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { TimeSeriesChart } from '@/ui/charts/TimeSeriesChart';
import { describeError } from '@/ui/errorText';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { Segmented } from '@/ui/Segmented';
import { formatBitRate, formatBytes } from '@/utils/format';
import { formatDayTime } from '@/utils/dates';

type Tab = 'ranking' | 'live';
type Sort = 'total' | 'rx' | 'tx';
const TABS: Tab[] = ['ranking', 'live'];
const CLASSES: Extract<TrafficClass, 'internet' | 'lan'>[] = ['internet', 'lan'];
const SORTS: Sort[] = ['total', 'rx', 'tx'];
const PAGE = 50;

/** Traffic by device (design TR-2, TR-3): totals, a curve, the ranking and live rates for a time range. */
export default function Traffic() {
  const t = useT();
  const nav = useRouter();
  const params = useLocalSearchParams<{ range?: string; tab?: string }>();
  const status = useAgentStatus();
  const [range, setRange] = useState<TimeRange>(() => parseRange(params.range) ?? DEFAULT_RANGE);
  // Presets resolve against this moment; it moves on when the range changes or on pull-to-refresh.
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState(false);

  return (
    <Screen
      title={t('traffic:title')}
      headerRight={
        <HeaderButton
          icon="more"
          // Without a working plugin the only useful destination is the plugin page.
          onPress={() => (status.data?.state === 'ok' ? setMenu(true) : nav.push(AGENT_PAGE, { withAnchor: true }))}
          accessibilityLabel={t('traffic:overview.settings')}
          testID="traffic-menu"
        />
      }
      onRefresh={() => {
        setNow(new Date());
        return status.refetch();
      }}>
      <AgentGate>
        {(info) => (
          <TrafficContent
            info={info}
            initialTab={params.tab === 'live' ? 'live' : 'ranking'}
            range={range}
            now={now}
            onRange={(r) => {
              setNow(new Date());
              setRange(r);
            }}
            menu={menu}
            onMenuClose={() => setMenu(false)}
            onDevice={(mac) =>
              nav.push(`/network/traffic/${encodeURIComponent(mac)}?range=${encodeURIComponent(serializeRange(range))}`)
            }
          />
        )}
      </AgentGate>
    </Screen>
  );
}

function TrafficContent({
  info,
  initialTab,
  range,
  now,
  onRange,
  menu,
  onMenuClose,
  onDevice,
}: {
  info: AgentInfo;
  initialTab: Tab;
  range: TimeRange;
  now: Date;
  onRange(r: TimeRange): void;
  menu: boolean;
  onMenuClose(): void;
  onDevice(mac: string): void;
}) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { connection } = useActiveRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [cls, setCls] = useState<(typeof CLASSES)[number]>('internet');
  const [sort, setSort] = useState<Sort>('total');
  const [pages, setPages] = useState(1);
  const label = useDeviceLabels();

  const { start, end } = resolveRange(range, now);
  const { mask, dropped } = usableHoursMask(range, start, now, info.retention.hourDays);
  const summary = useTrafficSummary({ start, end, cls, hoursMask: mask, sort, limit: PAGE * pages });
  const history = useTrafficHistory({ start, end, cls, hoursMask: mask });
  const live = useLiveTraffic(tab === 'live');

  const s = summary.data;
  const devices = s?.devices ?? [];
  const top = Math.max(1, ...devices.map((d) => (sort === 'rx' ? d.rx : sort === 'tx' ? d.tx : d.rx + d.tx)));

  const exportCsv = async (kind: 'devices' | 'curve') => {
    onMenuClose();
    try {
      const title = t('traffic:overview.exportTitle', { range: rangeLabel(t, range, lang, now) });
      if (kind === 'devices') {
        if (!connection) return;
        const all = await agentSummary(connection, { start, end, cls, hoursMask: mask, sort, limit: 500 });
        const names = new Map(all.devices.map((d) => [d.mac, label(d.mac).name]));
        await shareCsv(csvFileName('devices', start), summaryCsv(t, all, names, { start, end }), title);
      } else if (history.data) {
        await shareCsv(csvFileName('curve', start), historyCsv(t, history.data), title);
      }
    } catch (error) {
      toast(t('traffic:overview.exportFailed', { reason: describeError(t, error).title }), 'error');
    }
  };

  const fmtTime = (sec: number) => formatDayTime(sec, lang);

  return (
    <>
      <AgentBanner info={info} />
      <TimeRangePicker
        value={range}
        onChange={(r) => {
          setPages(1);
          onRange(r);
        }}
      />

      <GlassCard testID="traffic-totals" contentStyle={styles.card}>
        <View style={styles.totals}>
          <Total
            label={t('traffic:overview.down')}
            value={s ? formatBytes(s.rx) : undefined}
            color={colors.chartDown}
          />
          <Total label={t('traffic:overview.up')} value={s ? formatBytes(s.tx) : undefined} color={colors.chartUp} />
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t('traffic:overview.wanHint')}
            onPress={() => toast(t('traffic:overview.wanHint'), 'info')}
            style={styles.total}>
            <View style={styles.totalLabel}>
              <AppText variant="footnote" tone="secondary">
                {t('traffic:overview.wan')}
              </AppText>
              <Icon name="info" size={13} color={colors.textTertiary} />
            </View>
            <AppText variant="headline">{s ? formatBytes(s.wanRx + s.wanTx) : '—'}</AppText>
          </Pressable>
        </View>
        {history.data ? (
          <TimeSeriesChart
            points={history.data.points}
            step={history.data.step}
            start={start}
            end={end}
            testID="traffic-chart"
          />
        ) : (
          <Skeleton height={168} radius={12} />
        )}
        {dropped ? (
          <AppText variant="footnote" tone="tertiary">
            {t('traffic:range.hoursDropped', { days: info.retention.hourDays })}
          </AppText>
        ) : null}
        {s && s.startExact > start + 60 ? (
          <AppText variant="footnote" tone="tertiary">
            {t('traffic:overview.dataSince', { time: fmtTime(s.startExact) })}
          </AppText>
        ) : null}
      </GlassCard>

      <Segmented
        values={TABS.map((v) => t(`traffic:overview.${v}`))}
        selectedIndex={TABS.indexOf(tab)}
        onChange={(e) => setTab(TABS[e.nativeEvent.selectedSegmentIndex])}
      />

      {tab === 'ranking' ? (
        <>
          <View style={styles.filters}>
            <Segmented
              values={CLASSES.map((v) => t(`traffic:overview.${v}`))}
              selectedIndex={CLASSES.indexOf(cls)}
              onChange={(e) => {
                setPages(1);
                setCls(CLASSES[e.nativeEvent.selectedSegmentIndex]);
              }}
            />
            <Segmented
              values={SORTS.map((v) => t(`traffic:overview.sort.${v}`))}
              selectedIndex={SORTS.indexOf(sort)}
              onChange={(e) => setSort(SORTS[e.nativeEvent.selectedSegmentIndex])}
            />
          </View>
          {s ? (
            devices.length ? (
              <ListSection>
                {devices.map((d) => (
                  <DeviceTrafficRow
                    key={d.mac}
                    label={label(d.mac)}
                    rx={d.rx}
                    tx={d.tx}
                    share={(sort === 'rx' ? d.rx : sort === 'tx' ? d.tx : d.rx + d.tx) / top}
                    onPress={() => onDevice(d.mac)}
                  />
                ))}
                {s.count > devices.length ? (
                  <ListRow
                    title={t('traffic:overview.more')}
                    icon="chevronDown"
                    onPress={() => setPages((p) => p + 1)}
                  />
                ) : null}
              </ListSection>
            ) : (
              <EmptyState icon="chart" title={t('traffic:overview.empty')} />
            )
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={56} radius={14} />
              ))}
            </View>
          )}
        </>
      ) : (
        <ListSection>
          {live.data ? (
            [
              <ListRow
                key="wan"
                title={t('traffic:overview.wanRow')}
                subtitle={`↓ ${formatBitRate(live.data.live.wan.rxBps)} · ↑ ${formatBitRate(live.data.live.wan.txBps)} · ${t('traffic:overview.online', { count: live.data.live.online })}`}
                icon="globe"
              />,
              ...live.data.live.devices.map((d) => (
                <Animated.View key={d.mac} layout={LinearTransition.duration(250)}>
                  <LiveTrafficRow
                    label={label(d.mac)}
                    rxBps={d.rxBps}
                    txBps={d.txBps}
                    history={live.data!.history[d.mac] ?? []}
                    onPress={() => onDevice(d.mac)}
                  />
                </Animated.View>
              )),
            ]
          ) : (
            <ListRow title={t('traffic:overview.liveEmpty')} icon="pulse" />
          )}
        </ListSection>
      )}

      <ActionSheet
        visible={menu}
        actions={[
          { label: t('traffic:overview.exportDevices'), icon: 'share', onPress: () => void exportCsv('devices') },
          {
            label: t('traffic:overview.exportCurve'),
            icon: 'share',
            disabled: !history.data,
            onPress: () => void exportCsv('curve'),
          },
          ...(info.capabilities.includes('limits')
            ? [
                {
                  label: t('control:rules.entry'),
                  icon: 'speed' as const,
                  onPress: () => {
                    onMenuClose();
                    nav.push('/network/traffic/rules');
                  },
                },
              ]
            : []),
          {
            label: t('traffic:overview.settings'),
            icon: 'plugin',
            onPress: () => {
              onMenuClose();
              nav.push(AGENT_PAGE, { withAnchor: true });
            },
          },
        ]}
        onCancel={onMenuClose}
      />
    </>
  );
}

function Total({ label, value, color }: { label: string; value?: string; color: string }) {
  return (
    <View style={styles.total}>
      <AppText variant="footnote" tone="secondary">
        {label}
      </AppText>
      <AppText variant="headline" style={{ color }}>
        {value ?? '—'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
  totals: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.s },
  total: { flex: 1, gap: 2 },
  totalLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  filters: { gap: spacing.s },
  loading: { gap: spacing.s },
});
