import { useState } from 'react';

import { AgentGate } from '@/features/agent/AgentGate';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { byLocalDay, byLocalMonth, periodStart } from '@/features/traffic/aggregate';
import { useTrafficHistory, useTrafficSummary } from '@/hooks/agent-queries';
import { useLang, useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { BarChart, type Bar } from '@/ui/charts/BarChart';
import { Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { Segmented } from '@/ui/Segmented';
import { formatBytes } from '@/utils/format';
import { formatDay, formatMonth, formatMonthYear, formatNumericDay } from '@/utils/dates';

type Mode = 'daily' | 'monthly';
const MODES: Mode[] = ['daily', 'monthly'];

const midnightDaysAgo = (now: Date, days: number) =>
  Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime() / 1000);
const monthStartAgo = (now: Date, months: number) =>
  Math.floor(new Date(now.getFullYear(), now.getMonth() - months, 1).getTime() / 1000);

/** WAN usage per day (30 days) and per month (12 months), and the current billing period (design TR-5). */
export default function WanHistory() {
  const t = useT();
  const [now, setNow] = useState(() => new Date());
  return (
    <Screen title={t('traffic:wan.title')} onRefresh={() => setNow(new Date())}>
      <AgentGate>{() => <WanContent now={now} />}</AgentGate>
    </Screen>
  );
}

function WanContent({ now }: { now: Date }) {
  const t = useT();
  const lang = useLang();
  const { router } = useActiveRouter();
  const routerId = router?.id ?? 'none';
  const resetDay = useSettings((s) => s.wanResetDay[routerId]);
  const setResetDay = useSettings((s) => s.setWanResetDay);
  const [mode, setMode] = useState<Mode>('daily');
  const [picking, setPicking] = useState(false);
  const end = Math.floor(now.getTime() / 1000);

  // Hourly data summed per day, daily data summed per month (the plugin's own monthly tier starts later).
  const daily = useTrafficHistory(
    mode === 'daily' ? { cls: 'wan', start: midnightDaysAgo(now, 29), end, maxPoints: 1000 } : null,
  );
  const monthly = useTrafficHistory(
    mode === 'monthly' ? { cls: 'wan', start: monthStartAgo(now, 11), end, maxPoints: 1000 } : null,
  );
  const period = resetDay ? periodStart(resetDay, now) : null;
  const periodSummary = useTrafficSummary(period ? { start: period, end, limit: 1 } : null);

  const source = mode === 'daily' ? daily.data : monthly.data;
  const points = source ? (mode === 'daily' ? byLocalDay(source.points) : byLocalMonth(source.points)) : null;
  const bars: Bar[] = (points ?? []).map((p) => ({
    label: mode === 'daily' ? formatNumericDay(p.t) : formatMonth(p.t, lang),
    title: mode === 'daily' ? formatDay(p.t, lang, { weekday: true }) : formatMonthYear(p.t, lang),
    rx: p.rx,
    tx: p.tx,
  }));

  return (
    <>
      <Segmented
        values={MODES.map((m) => t(`traffic:wan.${m}`))}
        selectedIndex={MODES.indexOf(mode)}
        onChange={(e) => setMode(MODES[e.nativeEvent.selectedSegmentIndex])}
      />
      <GlassCard
        title={t(mode === 'daily' ? 'traffic:wan.last30' : 'traffic:wan.last12')}
        icon="calendar"
        testID="wan-chart">
        {points ? <BarChart bars={bars} /> : <Skeleton height={168} radius={12} />}
      </GlassCard>

      <ListSection footer={t('traffic:wan.resetHint')}>
        <ListRow
          title={t('traffic:wan.resetDay')}
          icon="calendar"
          value={resetDay ? t('traffic:wan.resetDayValue', { day: resetDay }) : t('traffic:wan.resetOff')}
          chevron
          onPress={() => setPicking(true)}
        />
        {period ? (
          <ListRow
            title={t('traffic:wan.period')}
            subtitle={t('traffic:wan.periodSince', {
              date: formatDay(period, lang),
            })}
            value={periodSummary.data ? formatBytes(periodSummary.data.wanRx + periodSummary.data.wanTx) : '…'}
          />
        ) : null}
      </ListSection>

      {points?.length ? (
        <ListSection title={t('traffic:wan.details')}>
          {[...bars].reverse().map((b, i) => (
            <ListRow
              key={`${b.title}-${i}`}
              title={b.title}
              value={b.rx === null ? '—' : `↓ ${formatBytes(b.rx)}  ↑ ${formatBytes(b.tx ?? 0)}`}
            />
          ))}
        </ListSection>
      ) : null}

      {picking ? (
        <SelectSheet
          visible
          title={t('traffic:wan.resetDay')}
          options={[
            { value: '0', label: t('traffic:wan.resetOff') },
            ...Array.from({ length: 31 }, (_, i) => ({
              value: String(i + 1),
              label: t('traffic:wan.resetDayValue', { day: i + 1 }),
            })),
          ]}
          value={String(resetDay ?? 0)}
          onSelect={(v) => {
            setPicking(false);
            setResetDay(routerId, v === '0' ? null : Number(v));
          }}
          onCancel={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}
