import { StyleSheet, View } from 'react-native';

import type { AppT } from '@/i18n';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatBitRate } from '@/utils/format';

import { round1 } from './present';

/** The parts of a speed test the screen shows, phone or router alike. */
export interface SpeedFiguresData {
  downBps: number | null;
  upBps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
}

export type LivePhase = 'starting' | 'latency' | 'download' | 'upload' | 'done' | 'failed';

export const rate = (bps: number | null | undefined) => (bps === null || bps === undefined ? '—' : formatBitRate(bps));

/** "↓ 180 Mbps · ↑ 45.2 Mbps" for history rows. */
export const speedRow = (t: AppT, r: SpeedFiguresData) =>
  t('diagnostics:speed.history.row', { down: rate(r.downBps), up: rate(r.upBps) });

/** The running test: which side and phase, the current rate in large type, a progress bar. */
export function SpeedMeter({
  stage,
  phase,
  progress,
  bps,
  showStage,
}: {
  stage: 'phone' | 'router';
  phase: LivePhase;
  progress: number;
  bps?: number;
  showStage: boolean;
}) {
  const t = useT();
  const { colors } = useTheme();
  const mbps = bps === undefined ? undefined : bps / 1e6;
  return (
    <View style={styles.meter} testID="speed-meter">
      <AppText variant="footnote" tone="secondary" align="center">
        {showStage
          ? `${t(`diagnostics:speed.stage.${stage}`)} · ${t(`diagnostics:speed.phase.${phase}`)}`
          : t(`diagnostics:speed.phase.${phase}`)}
      </AppText>
      <View style={styles.big}>
        <AppText variant="largeTitle" style={styles.number}>
          {mbps === undefined ? '—' : mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)}
        </AppText>
        <AppText variant="subhead" tone="secondary">
          Mbps
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: colors.fill }]}>
        <View
          style={[
            styles.bar,
            {
              backgroundColor: phase === 'upload' ? colors.chartUp : colors.chartDown,
              width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

/** Download, upload, latency and jitter of one result; the share of the plan under the rates when set. */
export function SpeedFigures({
  result,
  contract,
  testID,
}: {
  result: SpeedFiguresData;
  contract?: { downMbps?: number; upMbps?: number };
  testID?: string;
}) {
  const t = useT();
  const { colors } = useTheme();
  const share = (bps: number | null, mbps?: number) =>
    bps !== null && mbps ? t('diagnostics:speed.contractShare', { pct: Math.round((bps / 1e6 / mbps) * 100) }) : null;
  const items = [
    {
      label: t('diagnostics:speed.down'),
      value: rate(result.downBps),
      note: share(result.downBps, contract?.downMbps),
      color: colors.chartDown,
    },
    {
      label: t('diagnostics:speed.up'),
      value: rate(result.upBps),
      note: share(result.upBps, contract?.upMbps),
      color: colors.chartUp,
    },
    {
      label: t('diagnostics:speed.latency'),
      value: result.latencyMs === null ? '—' : t('diagnostics:speed.ms', { value: round1(result.latencyMs) }),
    },
    {
      label: t('diagnostics:speed.jitter'),
      value: result.jitterMs === null ? '—' : t('diagnostics:speed.ms', { value: round1(result.jitterMs) }),
    },
  ];
  return (
    <View style={styles.figures} testID={testID}>
      {items.map((i) => (
        <View key={i.label} style={styles.figure}>
          <AppText variant="footnote" tone="secondary">
            {i.label}
          </AppText>
          <AppText variant="headline" style={i.color ? { color: i.color } : undefined}>
            {i.value}
          </AppText>
          {i.note ? (
            <AppText variant="caption" tone="tertiary">
              {i.note}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meter: { gap: spacing.s, paddingVertical: spacing.s },
  big: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: spacing.xs },
  number: { fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.m },
  figure: { width: '50%', gap: 2, paddingRight: spacing.s },
});
