import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Line, Path } from 'react-native-svg';

import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { niceMax } from '@/ui/charts/area-path';
import { timeTicks } from '@/ui/charts/scale';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { formatClock, formatDayTime } from '@/utils/dates';
import { formatBitRate } from '@/utils/format';

export interface SignalChartPoint {
  /** Epoch seconds. */
  t: number;
  /** dBm */
  signal: number | null;
  /** Negotiated rate towards the device (download), kbit/s. */
  rate: number | null;
}

const AXIS = 18;
/** The signal axis: from a strong −30 dBm down to −95, where links drop. */
const TOP = -30;
const BOTTOM = -95;
/** Grade boundaries (design §17.1). */
const GRADE_LINES = [-60, -70, -80];

/** Lines break where a point is missing or the next one is more than a few steps away. */
function segments(points: readonly SignalChartPoint[], step: number): SignalChartPoint[][] {
  const gap = Math.max(step * 2.5, 5);
  const out: SignalChartPoint[][] = [];
  let run: SignalChartPoint[] = [];
  let last: SignalChartPoint | undefined;
  for (const p of points) {
    if (p.signal === null || (last && p.t - last.t > gap)) {
      if (run.length) out.push(run);
      run = [];
    }
    if (p.signal !== null) run.push(p);
    last = p;
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * A client's signal (dBm, fixed scale with the grade boundaries) and its negotiated download rate (own
 * scale, right). `live` labels the time axis "5 min ago … now". Press and drag to read a point.
 */
export function SignalChart({
  points,
  start,
  end,
  step,
  live,
  height = 168,
  testID,
}: {
  points: readonly SignalChartPoint[];
  start: number;
  end: number;
  /** Seconds between points. */
  step: number;
  live?: boolean;
  height?: number;
  testID?: string;
}) {
  const t = useT();
  const lang = useLang();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const plotH = height - AXIS;

  const rateMax = niceMax(Math.max(1, ...points.map((p) => (p.rate ?? 0) * 1000)));
  const span = Math.max(1, end - start);
  const x = (time: number) => Math.min(width, Math.max(0, ((time - start) / span) * width));
  const ySignal = (v: number) => ((Math.min(TOP, Math.max(BOTTOM, v)) - TOP) / (BOTTOM - TOP)) * plotH;
  const yRate = (kbit: number) => plotH - (Math.min(kbit * 1000, rateMax) / rateMax) * plotH;

  const runs = width ? segments(points, step) : [];
  const path = (run: SignalChartPoint[], y: (p: SignalChartPoint) => number | null) => {
    const xy = run.map((p) => [x(p.t), y(p)] as const).filter((c): c is readonly [number, number] => c[1] !== null);
    const d = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    // A single point still needs a visible mark.
    return xy.length === 1 ? `${d}h3` : d;
  };

  const pick = (px: number) => {
    if (!points.length || !width) return;
    const time = start + (Math.min(Math.max(px, 0), width) / width) * span;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - time) < Math.abs(points[best].t - time)) best = i;
    });
    setActive(best);
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
  const timeLabel = (time: number) => (live ? formatClock(time, { seconds: true }) : formatDayTime(time, lang));
  const ticks = live ? [] : timeTicks(start, end, width, lang);

  return (
    <View testID={testID} accessibilityRole="image">
      <View style={styles.readout}>
        {point ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>
            {point.signal === null
              ? `${timeLabel(point.t)} · ${t('wifitools:chart.missing')}`
              : [
                  timeLabel(point.t),
                  `${point.signal} dBm`,
                  point.rate !== null ? `↓ ${formatBitRate(point.rate * 1000)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </AppText>
        ) : (
          <View style={styles.legend}>
            <View style={[styles.swatch, { backgroundColor: colors.chartDown }]} />
            <AppText variant="caption" tone="secondary">
              {t('wifitools:chart.signal')}
            </AppText>
            <View style={[styles.swatch, { backgroundColor: colors.chartUp }]} />
            <AppText variant="caption" tone="secondary" style={styles.legendText} numberOfLines={1}>
              {t('wifitools:chart.rate')}
            </AppText>
          </View>
        )}
      </View>
      <GestureDetector gesture={scrub}>
        <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Svg width={width} height={height}>
              {GRADE_LINES.map((v) => (
                <Line
                  key={v}
                  x1={0}
                  x2={width}
                  y1={ySignal(v)}
                  y2={ySignal(v)}
                  stroke={colors.separator}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              ))}
              <Line x1={0} x2={width} y1={plotH} y2={plotH} stroke={colors.separator} strokeWidth={1} />
              {runs.map((run) => (
                <Path
                  key={`r${run[0].t}`}
                  d={path(run, (p) => (p.rate === null ? null : yRate(p.rate)))}
                  stroke={colors.chartUp}
                  strokeWidth={1.5}
                  fill="none"
                />
              ))}
              {runs.map((run) => (
                <Path
                  key={`s${run[0].t}`}
                  d={path(run, (p) => ySignal(p.signal!))}
                  stroke={colors.chartDown}
                  strokeWidth={2}
                  fill="none"
                />
              ))}
              {point ? (
                <Line x1={x(point.t)} x2={x(point.t)} y1={0} y2={plotH} stroke={colors.text} strokeWidth={1} />
              ) : null}
            </Svg>
          ) : null}
          {GRADE_LINES.map((v) => (
            <AppText key={v} variant="caption" tone="tertiary" style={[styles.gradeLabel, { top: ySignal(v) - 15 }]}>
              {v}
            </AppText>
          ))}
          <AppText variant="caption" tone="tertiary" style={styles.rateMax}>
            {formatBitRate(rateMax)}
          </AppText>
          {!points.some((p) => p.signal !== null) ? (
            <AppText variant="footnote" tone="tertiary" align="center" style={[styles.empty, { top: plotH / 2 - 9 }]}>
              {t('wifitools:chart.empty')}
            </AppText>
          ) : null}
          {live ? (
            <>
              <AppText variant="caption" tone="tertiary" style={[styles.edge, { left: 0, top: plotH + 3 }]}>
                {t('wifitools:chart.fiveMinutesAgo')}
              </AppText>
              <AppText variant="caption" tone="tertiary" style={[styles.edge, { right: 0, top: plotH + 3 }]}>
                {t('wifitools:chart.now')}
              </AppText>
            </>
          ) : (
            ticks.map((tick) => (
              <AppText
                key={tick.t}
                variant="caption"
                tone="tertiary"
                style={[styles.tick, { left: Math.min(Math.max(x(tick.t) - 24, 0), width - 48), top: plotH + 3 }]}>
                {tick.label}
              </AppText>
            ))
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { minHeight: 18, marginBottom: 4, justifyContent: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { flexShrink: 1 },
  swatch: { width: 10, height: 3, borderRadius: 1.5 },
  gradeLabel: { position: 'absolute', left: 2 },
  rateMax: { position: 'absolute', right: 0, top: 2 },
  empty: { position: 'absolute', left: 0, right: 0 },
  edge: { position: 'absolute' },
  tick: { position: 'absolute', width: 48, textAlign: 'center' },
});
