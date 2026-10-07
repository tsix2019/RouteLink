import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import type { LatencyPoint } from '@/api/services/agent-diag';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { niceMax } from '@/ui/charts/area-path';
import { runs, timeTicks } from '@/ui/charts/scale';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { formatDayTime } from '@/utils/dates';

import { msText, pctText } from './latency-export';

const AXIS = 18;
const LOSS_H = 26;
const GAP = 6;

/** The axis follows the 95th percentile of the maxima, so one spike does not flatten the curve. */
export function latencyAxisMax(points: readonly LatencyPoint[]): number {
  const maxima = points.flatMap((p) => (p.max === null ? [] : [p.max])).sort((a, b) => a - b);
  const averages = points.flatMap((p) => (p.avg === null ? [] : [p.avg]));
  const p95 = maxima.length ? maxima[Math.floor(0.95 * (maxima.length - 1))] : 0;
  return niceMax(Math.max(1, p95, ...averages));
}

export interface LatencyChartProps {
  points: readonly LatencyPoint[];
  /** Seconds per point. */
  step: number;
  start: number;
  end: number;
  height?: number;
  testID?: string;
}

/**
 * One probe target over time (design §18.3): average and maximum round trip as lines, loss as bars in a
 * strip underneath. Gaps without data break the lines; press and hold to read a point.
 */
export function LatencyChart({ points, step, start, end, height = 196, testID }: LatencyChartProps) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const plotH = height - AXIS - LOSS_H - GAP;
  const lossTop = plotH + GAP;

  const max = latencyAxisMax(points);
  const span = Math.max(1, end - start);
  const x = (time: number) => Math.min(width, Math.max(0, ((time - start) / span) * width));
  const xMid = (i: number) => x(points[i].t + step / 2);
  const y = (v: number) => plotH - (Math.min(v, max) / max) * plotH;

  const segments = width ? runs(points.map((p) => ({ rx: p.avg }))) : [];
  const line = (from: number, to: number, key: 'avg' | 'max') => {
    if (from === to) return `M${(xMid(from) - 2).toFixed(1)},${y(points[from][key] ?? 0).toFixed(1)}h4`;
    let d = '';
    for (let i = from; i <= to; i++)
      d += `${i > from ? 'L' : 'M'}${xMid(i).toFixed(1)},${y(points[i][key] ?? 0).toFixed(1)}`;
    return d;
  };
  const ticks = timeTicks(start, end, width, lang);

  const pick = (px: number) => {
    if (!points.length || !width) return;
    const time = start + (Math.min(Math.max(px, 0), width) / width) * span;
    setActive(Math.min(points.length - 1, Math.max(0, Math.floor((time - points[0].t) / step))));
  };
  useEffect(() => {
    if (active !== null) void Haptics.selectionAsync().catch(() => {});
  }, [active]);
  const scrub = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(180)
    .onStart((e) => pick(e.x))
    .onUpdate((e) => pick(e.x))
    .onFinalize(() => setActive(null));

  const point = active !== null ? points[active] : null;
  const barW = Math.max(1, (width / Math.max(1, span)) * step - 0.5);

  return (
    <View testID={testID} accessibilityRole="image">
      <View style={styles.readout}>
        {point ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>
            {point.avg === null
              ? `${formatDayTime(point.t, lang)} · ${t('diagnostics:latency.missing')}`
              : t('diagnostics:latency.point', {
                  time: formatDayTime(point.t, lang),
                  avg: msText(point.avg),
                  max: msText(point.max),
                  loss: pctText(point.loss),
                })}
          </AppText>
        ) : (
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {t('diagnostics:latency.chartHint')}
          </AppText>
        )}
      </View>
      <GestureDetector gesture={scrub}>
        <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Svg width={width} height={height}>
              {[0, 0.5, 1].map((f) => (
                <Line
                  key={f}
                  x1={0}
                  x2={width}
                  y1={f * plotH}
                  y2={f * plotH}
                  stroke={colors.separator}
                  strokeWidth={StyleSheet.hairlineWidth}
                />
              ))}
              <Line
                x1={0}
                x2={width}
                y1={lossTop + LOSS_H}
                y2={lossTop + LOSS_H}
                stroke={colors.separator}
                strokeWidth={StyleSheet.hairlineWidth}
              />
              {segments
                .filter((s) => s.missing)
                .map((g) => {
                  const left = x(points[g.from].t);
                  const right = x(points[g.to].t + step);
                  return (
                    <Rect
                      key={`gap${g.from}`}
                      x={left + 1}
                      y={1}
                      width={Math.max(0, right - left - 2)}
                      height={plotH - 2}
                      rx={6}
                      fill="none"
                      stroke={colors.textTertiary}
                      strokeDasharray="4 4"
                    />
                  );
                })}
              {segments
                .filter((s) => !s.missing)
                .map((s) => (
                  <Path
                    key={`max${s.from}`}
                    d={line(s.from, s.to, 'max')}
                    stroke={colors.chartUp}
                    strokeOpacity={0.6}
                    strokeWidth={1}
                    fill="none"
                  />
                ))}
              {segments
                .filter((s) => !s.missing)
                .map((s) => (
                  <Path
                    key={`avg${s.from}`}
                    d={line(s.from, s.to, 'avg')}
                    stroke={colors.chartDown}
                    strokeWidth={2}
                    fill="none"
                  />
                ))}
              {points.map((p, i) =>
                p.loss ? (
                  <Rect
                    key={`loss${i}`}
                    x={x(p.t)}
                    y={lossTop + LOSS_H - (Math.min(100, p.loss) / 100) * LOSS_H}
                    width={barW}
                    height={Math.max(1, (Math.min(100, p.loss) / 100) * LOSS_H)}
                    fill={colors.danger}
                  />
                ) : null,
              )}
              {active !== null ? (
                <Line
                  x1={xMid(active)}
                  x2={xMid(active)}
                  y1={0}
                  y2={lossTop + LOSS_H}
                  stroke={colors.text}
                  strokeWidth={1}
                />
              ) : null}
            </Svg>
          ) : null}
          <AppText variant="caption" tone="tertiary" style={styles.axisMax}>
            {`${max} ms`}
          </AppText>
          <AppText variant="caption" tone="tertiary" style={[styles.axisMax, { top: lossTop }]}>
            {t('diagnostics:latency.loss')}
          </AppText>
          {ticks.map((tick) => (
            <AppText
              key={tick.t}
              variant="caption"
              tone="tertiary"
              style={[
                styles.tick,
                { left: Math.min(Math.max(x(tick.t) - 24, 0), width - 48), top: lossTop + LOSS_H + 3 },
              ]}>
              {tick.label}
            </AppText>
          ))}
        </View>
      </GestureDetector>
      <View style={styles.legend}>
        <Legend color={colors.chartDown} label={t('diagnostics:latency.avg')} />
        <Legend color={colors.chartUp} label={t('diagnostics:latency.max')} />
        <Legend color={colors.danger} label={t('diagnostics:latency.loss')} bar />
      </View>
    </View>
  );
}

function Legend({ color, label, bar }: { color: string; label: string; bar?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[bar ? styles.legendBar : styles.legendLine, { backgroundColor: color }]} />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { minHeight: 18, marginBottom: 4 },
  axisMax: { position: 'absolute', right: 0, top: 2 },
  tick: { position: 'absolute', width: 48, textAlign: 'center' },
  legend: { flexDirection: 'row', gap: spacing.l, marginTop: spacing.s },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendBar: { width: 6, height: 10, borderRadius: 1 },
});
