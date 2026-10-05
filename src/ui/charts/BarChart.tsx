import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Line, Rect } from 'react-native-svg';

import { useT } from '@/i18n';
import { formatBytes } from '@/utils/format';

import { AppText } from '../AppText';
import { useTheme } from '../theme/ThemeProvider';
import { niceMax } from './area-path';

export interface Bar {
  /** Axis label, e.g. "10/5" or "Oct". */
  label: string;
  /** Longer label for the readout, e.g. "Oct 5, 2026". */
  title: string;
  rx: number | null;
  tx: number | null;
}

const AXIS = 18;

/** Download and upload per day or month side by side; tap a pair to read it. */
export function BarChart({ bars, height = 168, testID }: { bars: readonly Bar[]; height?: number; testID?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const plotH = height - AXIS;
  const max = niceMax(Math.max(1, ...bars.map((b) => Math.max(b.rx ?? 0, b.tx ?? 0))));
  const slot = bars.length ? width / bars.length : 0;
  const barW = Math.max(1.5, Math.min(10, slot * 0.32));
  const h = (v: number | null) => ((v ?? 0) / max) * plotH;
  // Label every n-th bar so labels never overlap.
  const every = Math.max(1, Math.ceil(44 / Math.max(1, slot)));
  const shown = selected !== null ? bars[selected] : null;

  return (
    <View testID={testID} accessibilityRole="image">
      <View style={styles.readout}>
        {shown ? (
          <AppText variant="footnote" tone="secondary" numberOfLines={1}>
            {shown.rx === null
              ? `${shown.title} · ${t('traffic:chart.missing')}`
              : `${shown.title} · ↓ ${formatBytes(shown.rx)} · ↑ ${formatBytes(shown.tx ?? 0)}`}
          </AppText>
        ) : (
          <AppText variant="caption" tone="tertiary">
            {formatBytes(max)}
          </AppText>
        )}
      </View>
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
            {bars.map((b, i) => {
              const cx = slot * i + slot / 2;
              const dim = selected !== null && selected !== i ? 0.35 : 1;
              return (
                <G key={i}>
                  {b.rx === null ? (
                    <Rect
                      x={cx - barW}
                      y={plotH - 6}
                      width={barW * 2}
                      height={6}
                      fill="none"
                      stroke={colors.textTertiary}
                      strokeDasharray="2 2"
                    />
                  ) : (
                    <>
                      <Rect
                        x={cx - barW - 0.5}
                        y={plotH - h(b.rx)}
                        width={barW}
                        height={h(b.rx)}
                        rx={Math.min(3, barW / 2)}
                        fill={colors.chartDown}
                        opacity={dim}
                      />
                      <Rect
                        x={cx + 0.5}
                        y={plotH - h(b.tx)}
                        width={barW}
                        height={h(b.tx)}
                        rx={Math.min(3, barW / 2)}
                        fill={colors.chartUp}
                        opacity={dim}
                      />
                    </>
                  )}
                </G>
              );
            })}
          </Svg>
        ) : null}
        {width > 0
          ? bars.map((b, i) =>
              i % every === 0 ? (
                <AppText
                  key={`l${i}`}
                  variant="caption"
                  tone="tertiary"
                  style={[styles.label, { left: slot * i + slot / 2 - 22, top: plotH + 3 }]}>
                  {b.label}
                </AppText>
              ) : null,
            )
          : null}
        <View style={[StyleSheet.absoluteFill, styles.hits]}>
          {bars.map((b, i) => (
            <Pressable
              key={`p${i}`}
              style={styles.hit}
              accessibilityRole="button"
              accessibilityLabel={b.title}
              onPress={() => setSelected(selected === i ? null : i)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { minHeight: 18, marginBottom: 4 },
  label: { position: 'absolute', width: 44, textAlign: 'center' },
  hits: { flexDirection: 'row' },
  hit: { flex: 1 },
});
