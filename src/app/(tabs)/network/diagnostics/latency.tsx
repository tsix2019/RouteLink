import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import type { AgentInfo } from '@/api/services/agent';
import { agentLatency, agentOutages, lossPct } from '@/api/services/agent-diag';
import { AGENT_PAGE, AgentGate } from '@/features/agent/AgentGate';
import { LatencyChart } from '@/features/diagnostics/LatencyChart';
import {
  availabilityText,
  exportFileName,
  latencyCsv,
  latencyText,
  msText,
  outageEnd,
  outagesCsv,
  pctText,
  targetLabel,
} from '@/features/diagnostics/latency-export';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { shareCsv } from '@/features/traffic/share';
import { TimeRangePicker } from '@/features/traffic/TimeRangePicker';
import { DEFAULT_RANGE, rangeLabel, resolveRange, type TimeRange } from '@/features/traffic/timeRange';
import { AGENT_KEY, useAgentStatus } from '@/hooks/agent-queries';
import { useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner, EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDayTime } from '@/utils/dates';
import { formatDuration } from '@/utils/format';

const PAGE = 50;
/** Points per target for the chart; exports ask for more. */
const CHART_POINTS = 240;
const EXPORT_POINTS = 1_440;

/** Outages and latency (design §18.3, DG-3): the plugin's probes for a time range, exportable as evidence. */
export default function Latency() {
  const t = useT();
  const nav = useRouter();
  const status = useAgentStatus();
  const [range, setRange] = useState<TimeRange>(DEFAULT_RANGE);
  // Presets resolve against this moment; it moves on when the range changes or on pull-to-refresh.
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState(false);
  const usable = status.data?.state === 'ok' && status.data.info.modules.includes('latency');

  return (
    <Screen
      title={t('diagnostics:latency.title')}
      headerRight={
        <HeaderButton
          icon="share"
          onPress={() => (usable ? setMenu(true) : nav.push(AGENT_PAGE, { withAnchor: true }))}
          accessibilityLabel={t('diagnostics:latency.export')}
          testID="latency-export"
        />
      }
      onRefresh={() => {
        setNow(new Date());
        return status.refetch();
      }}>
      <AgentGate>
        {(info) => (
          <LatencyContent
            info={info}
            range={range}
            now={now}
            onRange={(r) => {
              setNow(new Date());
              setRange(r);
            }}
            menu={menu}
            onMenuClose={() => setMenu(false)}
          />
        )}
      </AgentGate>
    </Screen>
  );
}

function LatencyContent({
  info,
  range,
  now,
  onRange,
  menu,
  onMenuClose,
}: {
  info: AgentInfo;
  range: TimeRange;
  now: Date;
  onRange(r: TimeRange): void;
  menu: boolean;
  onMenuClose(): void;
}) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { router, connection } = useActiveRouter();
  const [target, setTarget] = useState<number | null>(null);
  const [pages, setPages] = useState(1);

  const capable = info.capabilities.includes('latency');
  const enabled = capable && info.modules.includes('latency');
  const { start, end } = resolveRange(range, now);
  const latency = useRouterQuery(
    [AGENT_KEY, 'latency', start, end],
    (c) => agentLatency(c, { start, end, maxPoints: CHART_POINTS }),
    { enabled, staleTime: 30_000 },
  );
  const outages = useRouterQuery([AGENT_KEY, 'outages', start, end], (c) => agentOutages(c, { start, end }), {
    enabled,
    staleTime: 30_000,
  });

  if (!enabled) {
    const key = capable ? 'notEnabled' : 'tooOld';
    return (
      <EmptyState
        icon="plugin"
        title={t(`diagnostics:latency.${key}.title`)}
        message={t(`diagnostics:latency.${key}.message`)}
        action={{
          label: t(`diagnostics:latency.${key}.action`),
          onPress: () => nav.push(AGENT_PAGE, { withAnchor: true }),
        }}
      />
    );
  }

  const h = latency.data;
  const log = outages.data;
  // The custom targets tell about the internet; the next hop only about the line to the provider.
  const shownId =
    h?.targets.find((x) => x.id === target)?.id ?? h?.targets.find((x) => x.kind === 'custom')?.id ?? h?.targets[0]?.id;
  const shown = h?.targets.find((x) => x.id === shownId);
  const series = h?.series.find((s) => s.target === shownId);
  const hasData = !!h?.series.some((s) => s.points.some((p) => p.avg !== null));
  const routerName = router?.isDemo ? t('demoRouter') : (router?.name ?? '');
  const label = rangeLabel(t, range, lang, now);

  const exportAs = async (kind: 'outages' | 'latency' | 'text') => {
    onMenuClose();
    try {
      const title = t('diagnostics:latency.exportTitle', { range: label });
      if (kind === 'outages') {
        if (log) await shareCsv(exportFileName('outages', start), outagesCsv(t, log), title);
      } else if (kind === 'latency') {
        if (!connection) return;
        const all = await agentLatency(connection, { start, end, maxPoints: EXPORT_POINTS });
        await shareCsv(exportFileName('latency', start), latencyCsv(t, all), title);
      } else if (log) {
        await Share.share({ message: latencyText(t, lang, { router: routerName, range: label, log, history: h }) });
      }
    } catch (error) {
      toast(t('diagnostics:latency.exportFailed', { reason: describeError(t, error).title }), 'error');
    }
  };

  return (
    <>
      {!info.timeSynced ? <Banner tone="warning" text={t('agent:banner.time')} /> : null}
      <TimeRangePicker
        value={range}
        onChange={(r) => {
          setPages(1);
          onRange(r);
        }}
      />
      {range.hours ? (
        <AppText variant="footnote" tone="tertiary" style={styles.note}>
          {t('diagnostics:latency.hoursIgnored')}
        </AppText>
      ) : null}

      <GlassCard testID="latency-stats" contentStyle={styles.stats}>
        <Stat
          label={t('diagnostics:latency.availability')}
          value={log ? availabilityText(log.availability) : undefined}
        />
        <Stat
          label={t('diagnostics:latency.outages')}
          value={log ? String(log.count) : undefined}
          color={log?.count ? colors.warning : undefined}
        />
        <Stat label={t('diagnostics:latency.downtime')} value={log ? formatDuration(log.totalSec, lang) : undefined} />
      </GlassCard>

      {latency.isError ? (
        <ErrorState error={latency.error} onRetry={() => void latency.refetch()} />
      ) : (
        <GlassCard
          title={shown ? `${shown.ip}` : t('diagnostics:latency.targets')}
          subtitle={shown ? targetLabel(t, shown) : undefined}
          icon="pulse"
          testID="latency-chart">
          {h && series ? (
            hasData ? (
              <LatencyChart points={series.points} step={h.step} start={start} end={end} />
            ) : (
              <EmptyState icon="pulse" title={t('diagnostics:latency.noData')} />
            )
          ) : h ? (
            <EmptyState icon="pulse" title={t('diagnostics:latency.noData')} />
          ) : (
            <Skeleton height={196} radius={12} />
          )}
        </GlassCard>
      )}

      {h?.targets.length ? (
        <ListSection title={t('diagnostics:latency.targets')}>
          {h.targets.map((x) => {
            const s = h.summary.find((v) => v.target === x.id);
            return (
              <ListRow
                key={x.id}
                title={x.ip}
                subtitle={`${targetLabel(t, x)} · ${t('diagnostics:latency.targetStats', {
                  avg: msText(s?.avgMs),
                  max: msText(s?.maxMs),
                  loss: pctText(s ? lossPct(s) : null),
                })}`}
                right={x.id === shownId ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
                onPress={() => setTarget(x.id)}
                testID={`latency-target-${x.ip}`}
              />
            );
          })}
        </ListSection>
      ) : null}

      <ListSection title={t('diagnostics:latency.outageList')} footer={t('diagnostics:latency.footer')}>
        {log ? (
          log.outages.length ? (
            [
              ...[...log.outages]
                .reverse()
                .slice(0, PAGE * pages)
                .map((o) => (
                  <ListRow
                    key={o.start}
                    icon="warning"
                    iconColor={o.ongoing ? colors.danger : colors.warning}
                    title={`${formatDayTime(o.start, lang)} – ${o.ongoing ? t('diagnostics:latency.ongoing') : outageEnd(o, lang)}`}
                    subtitle={t('diagnostics:latency.outageRow', {
                      cause: t(`diagnostics:latency.cause.${o.cause}`),
                      duration: formatDuration(o.duration, lang),
                    })}
                  />
                )),
              ...(log.outages.length > PAGE * pages
                ? [
                    <ListRow
                      key="more"
                      title={t('traffic:overview.more')}
                      icon="chevronDown"
                      onPress={() => setPages((p) => p + 1)}
                    />,
                  ]
                : []),
            ]
          ) : (
            <ListRow title={t('diagnostics:latency.noOutages')} icon="check" iconColor={colors.success} />
          )
        ) : outages.isError ? (
          <ListRow
            title={describeError(t, outages.error).title}
            icon="warning"
            iconColor={colors.danger}
            onPress={() => void outages.refetch()}
          />
        ) : (
          <View style={styles.loading}>
            <Skeleton height={44} radius={10} />
          </View>
        )}
      </ListSection>

      <ActionSheet
        visible={menu}
        actions={[
          {
            label: t('diagnostics:latency.exportOutages'),
            icon: 'share',
            disabled: !log,
            onPress: () => void exportAs('outages'),
          },
          { label: t('diagnostics:latency.exportLatency'), icon: 'share', onPress: () => void exportAs('latency') },
          {
            label: t('diagnostics:latency.shareText'),
            icon: 'logs',
            disabled: !log,
            onPress: () => void exportAs('text'),
          },
        ]}
        onCancel={onMenuClose}
      />
    </>
  );
}

function Stat({ label, value, color }: { label: string; value?: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="footnote" tone="secondary">
        {label}
      </AppText>
      <AppText variant="headline" style={color ? { color } : undefined}>
        {value ?? '—'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.s },
  stat: { flex: 1, gap: 2 },
  note: { marginHorizontal: spacing.l },
  loading: { padding: spacing.m },
});
