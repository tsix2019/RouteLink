import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { HistoryPoint } from '@/api/services/agent';
import { useLang, useT } from '@/i18n';
import { formatBitRate, formatBytes } from '@/utils/format';

import { AppText } from '../AppText';
import { useTheme } from '../theme/ThemeProvider';
import { niceMax } from './area-path';
import { runs, timeTicks } from './scale';

const AXIS = 18;

export interface TimeSeriesChartProps {
  points: readonly HistoryPoint[];
  /** Seconds per point. */
  step: number;
  start: number;
  end: number;
  height?: number;
  testID?: string;
}

const toRate = (bytes: number | null, step: number) => (bytes === null || step <= 0 ? null : (bytes * 8) / step);

/**
 * Download and upload over time as rates (the bytes of each step spread over the step). Gaps where the
 * router has no data break the lines and show as a dashed box; press and drag to read a point.
 */
export function TimeSeriesChart({ points, step, start, end, height = 168, testID }: TimeSeriesChartProps) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const plotH = height - AXIS;

  const rates = points.map((p) => ({ t: p.t, rx: toRate(p.rx, step), tx: toRate(p.tx, step) }));
  const max = niceMax(Math.max(1, ...rates.map((r) => Math.max(r.rx ?? 0, r.tx ?? 0))));
  const span = Math.max(1, end - start);
  const x = (time: number) => Math.min(width, Math.max(0, ((time - start) / span) * width));
  const xMid = (i: number) => x(rates[i].t + step / 2);
  const y = (v: number) => plotH - (Math.min(v, max) / max) * plotH;

  const paths = !width
    ? []
    : runs(points)
        .filter((r) => !r.missing)
        .map((r) => {
          const idx = Array.from({ length: r.to - r.from + 1 }, (_, k) => r.from + k);
          const line = (key: 'rx' | 'tx') =>
            idx.map((i, k) => `${k ? 'L' : 'M'}${xMid(i).toFixed(1)},${y(rates[i][key] ?? 0).toFixed(1)}`).join('');
          const close = `L${xMid(r.to).toFixed(1)},${plotH}L${xMid(r.from).toFixed(1)},${plotH}Z`;
          const rx = line('rx');
          const tx = line('tx');
          // A single point still needs a visible mark: a short flat segment around it.
          const single = (key: 'rx' | 'tx') =>
            `M${(xMid(r.from) - 2).toFixed(1)},${y(rates[r.from][key] ?? 0).toFixed(1)}h4`;
          return idx.length > 1
            ? { key: r.from, rx, tx, rxArea: rx + close, txArea: tx + close }
            : { key: r.from, rx: single('rx'), tx: single('tx'), rxArea: '', txArea: '' };
        });

  const gaps = width ? runs(points).filter((r) => r.missing) : [];
  const ticks = timeTicks(start, end, width, lang);

  const pick = (px: number) => {
    if (!rates.length || !width) return;
    const time = start + (Math.min(Math.max(px, 0), width) / width) * span;
    const i = Math.min(rates.length - 1, Math.max(0, Math.floor((time - rates[0].t) / step)));
    setActive(i);
  };
  // A light tick whenever the finger reaches another point.
  useEffect(() => {
    if (active !== null) void Haptics.selectionAsync().catch(() => {});
  }, [active]);
  const scrub = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(180)
    .onStart((e) => pick(e.x))
    .onUpdate((e) => pick(e.x))
    .onFinalize(() => setActive(null));

  const point = active !== null ? rates[active] : null;
  const timeLabel = (time: number) =>
    new Date(time * 1000).toLocaleString(lang, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

  return (
    <View testID={testID} accessibilityRole="image">
      <View style={styles.readout}>
        {point ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>
            {point.rx === null
              ? `${timeLabel(point.t)} · ${t('traffic:chart.missing')}`
              : `${timeLabel(point.t)} · ↓ ${formatBitRate(point.rx)} · ↑ ${formatBitRate(point.tx ?? 0)} · ${formatBytes(
                  (points[active!].rx ?? 0) + (points[active!].tx ?? 0),
                )}`}
          </AppText>
        ) : (
          <AppText variant="caption" tone="tertiary">
            {formatBitRate(max)}
          </AppText>
        )}
      </View>
      <GestureDetector gesture={scrub}>
        <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="tsDown" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.chartDown} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={colors.chartDown} stopOpacity={0} />
                </LinearGradient>
                <LinearGradient id="tsUp" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.chartUp} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={colors.chartUp} stopOpacity={0} />
                </LinearGradient>
              </Defs>
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
              {gaps.map((g) => {
                const left = x(rates[g.from].t);
                const right = x(rates[g.to].t + step);
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
              {paths.map((p) => (
                <Path key={`da${p.key}`} d={p.rxArea} fill="url(#tsDown)" />
              ))}
              {paths.map((p) => (
                <Path key={`ua${p.key}`} d={p.txArea} fill="url(#tsUp)" />
              ))}
              {paths.map((p) => (
                <Path key={`dl${p.key}`} d={p.rx} stroke={colors.chartDown} strokeWidth={2} fill="none" />
              ))}
              {paths.map((p) => (
                <Path key={`ul${p.key}`} d={p.tx} stroke={colors.chartUp} strokeWidth={1.5} fill="none" />
              ))}
              {active !== null ? (
                <Line x1={xMid(active)} x2={xMid(active)} y1={0} y2={plotH} stroke={colors.text} strokeWidth={1} />
              ) : null}
            </Svg>
          ) : null}
          {gaps
            .filter((g) => width && x(rates[g.to].t + step) - x(rates[g.from].t) > 72)
            .map((g) => (
              <AppText
                key={`gl${g.from}`}
                variant="caption"
                tone="tertiary"
                style={[
                  styles.gapLabel,
                  { left: x(rates[g.from].t), width: x(rates[g.to].t + step) - x(rates[g.from].t), top: plotH / 2 - 8 },
                ]}>
                {t('traffic:chart.missing')}
              </AppText>
            ))}
          {ticks.map((tick) => (
            <AppText
              key={tick.t}
              variant="caption"
              tone="tertiary"
              style={[styles.tick, { left: Math.min(Math.max(x(tick.t) - 24, 0), width - 48), top: plotH + 3 }]}>
              {tick.label}
            </AppText>
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { minHeight: 18, marginBottom: 4 },
  gapLabel: { position: 'absolute', textAlign: 'center' },
  tick: { position: 'absolute', width: 48, textAlign: 'center' },
});
