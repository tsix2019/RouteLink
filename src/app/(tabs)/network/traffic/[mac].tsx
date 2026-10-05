import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AgentEvent, History } from '@/api/services/agent';
import { AgentGate } from '@/features/agent/AgentGate';
import { useDeviceLabels } from '@/features/traffic/labels';
import { TimeRangePicker } from '@/features/traffic/TimeRangePicker';
import { DEFAULT_RANGE, hoursMask, parseRange, resolveRange, type TimeRange } from '@/features/traffic/timeRange';
import { useAgentEvents, useTrafficHistory } from '@/hooks/agent-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { TimeSeriesChart } from '@/ui/charts/TimeSeriesChart';
import { Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { InfoGrid } from '@/ui/InfoGrid';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatBitRate, formatBytes, formatDuration } from '@/utils/format';
import { formatDayTime } from '@/utils/dates';

const EVENT_TYPES = ['device_new', 'device_online', 'device_offline'] as const;

/** Sums and the busiest step of a device's history. */
function stats(h: History) {
  let rx = 0;
  let tx = 0;
  let peak = 0;
  for (const p of h.points) {
    rx += p.rx ?? 0;
    tx += p.tx ?? 0;
    peak = Math.max(peak, p.rx ?? 0);
  }
  return { rx, tx, peakBps: h.step > 0 ? (peak * 8) / h.step : 0 };
}

/** One device's traffic (design TR-4): curve, totals, peak and its online/offline record. */
export default function DeviceTraffic() {
  const t = useT();
  const params = useLocalSearchParams<{ mac: string; range?: string }>();
  const mac = decodeURIComponent(params.mac ?? '');
  const [range, setRange] = useState<TimeRange>(() => parseRange(params.range) ?? DEFAULT_RANGE);
  const [now, setNow] = useState(() => new Date());
  const label = useDeviceLabels()(mac);

  return (
    <Screen title={label.name} onRefresh={() => setNow(new Date())}>
      <AgentGate>
        {() => (
          <Content
            mac={mac}
            range={range}
            now={now}
            onRange={(r) => {
              setNow(new Date());
              setRange(r);
            }}
          />
        )}
      </AgentGate>
      {mac ? null : <AppText>{t('devices:detail.notFound')}</AppText>}
    </Screen>
  );
}

function Content({
  mac,
  range,
  now,
  onRange,
}: {
  mac: string;
  range: TimeRange;
  now: Date;
  onRange(r: TimeRange): void;
}) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const label = useDeviceLabels()(mac);
  const { start, end } = resolveRange(range, now);
  const mask = range.hours ? hoursMask(range.hours) : undefined;
  const history = useTrafficHistory({ mac, start, end, hoursMask: mask });
  const events = useAgentEvents({ mac, start, end, types: [...EVENT_TYPES], limit: 200 });
  const s = history.data ? stats(history.data) : null;
  const step = history.data?.step ?? 0;

  const fmt = (sec: number) => formatDayTime(sec, lang);
  const list = events.data?.events ?? [];
  /** Newest first: an event lasts until the next (newer) one, the newest until now. */
  const lasted = (i: number) => (i === 0 ? Math.floor(now.getTime() / 1000) : list[i - 1].ts) - list[i].ts;

  return (
    <>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: label.online !== false ? colors.accent : colors.separator }]}>
          <Icon name={label.icon} size={26} color={label.online !== false ? colors.accentText : colors.textSecondary} />
        </View>
        <View style={styles.headerText}>
          <View style={styles.statusRow}>
            <StatusDot status={label.online === undefined ? 'unknown' : label.online ? 'online' : 'offline'} />
            <AppText variant="subhead" tone="secondary">
              {label.online === undefined ? mac : `${label.online ? t('online') : t('offline')} · ${label.detail}`}
            </AppText>
          </View>
          <AppText variant="footnote" tone="tertiary" selectable>
            {[mac, label.client?.vendor].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </View>

      <TimeRangePicker value={range} onChange={onRange} />

      <GlassCard>
        {history.data ? (
          <TimeSeriesChart points={history.data.points} step={history.data.step} start={start} end={end} />
        ) : (
          <Skeleton height={168} radius={12} />
        )}
        <InfoGrid
          items={[
            { label: t('traffic:overview.down'), value: s ? formatBytes(s.rx) : undefined },
            { label: t('traffic:overview.up'), value: s ? formatBytes(s.tx) : undefined },
            { label: t('traffic:device.total'), value: s ? formatBytes(s.rx + s.tx) : undefined },
            {
              label: t('traffic:device.peak'),
              value: s
                ? `${formatBitRate(s.peakBps)} (${
                    step >= 3600
                      ? t('traffic:device.peakNoteHours', { hours: Math.round(step / 3600) })
                      : t('traffic:device.peakNote', { minutes: Math.max(1, Math.round(step / 60)) })
                  })`
                : undefined,
              wide: true,
            },
          ]}
        />
      </GlassCard>

      <ListSection title={t('traffic:device.events')}>
        {list.length ? (
          list.map((e: AgentEvent, i) => (
            <ListRow
              key={`${e.ts}-${e.type}`}
              title={t(`traffic:device.event.${e.type as (typeof EVENT_TYPES)[number]}`)}
              subtitle={
                e.type === 'device_new'
                  ? undefined
                  : t('traffic:device.lasted', { duration: formatDuration(lasted(i), lang) })
              }
              value={fmt(e.ts)}
              left={<StatusDot status={e.type === 'device_offline' ? 'offline' : 'online'} />}
            />
          ))
        ) : (
          <ListRow title={events.data ? t('traffic:device.noEvents') : t('loading')} />
        )}
      </ListSection>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
