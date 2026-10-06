import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import type { Band } from '@/api/services/clients';
import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme/ThemeProvider';

import { channelFreq, type Span } from './channel';
import type { ChartNetwork } from './channelScan';

const AXIS = 18;
const LABEL = 16;
/** Signal scale: a −95 dBm network barely shows, −30 dBm fills the height. */
const FLOOR = -95;
const TOP = -30;
/** Minimum pixels per MHz: 5 GHz spans 665 MHz and scrolls sideways rather than squeezing. */
const MIN_PX: Record<Band, number> = { '2.4G': 0, '5G': 1.3, '6G': 0.5 };
const LABEL_FROM = -75;

/**
 * Channel occupancy (design §17.2): each network a trapezoid over the frequencies it occupies, as high as
 * it is strong. The group's own networks are highlighted; `self` outlines the radio being looked at and
 * `target` the channel it is advised to move to.
 */
export function ChannelChart({
  band,
  range,
  channels,
  networks,
  self,
  target,
  height = 150,
  testID,
}: {
  band: Band;
  range: Span;
  /** Channels labelled on the axis. */
  channels: number[];
  networks: ChartNetwork[];
  self?: Span;
  target?: Span;
  height?: number;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [box, setBox] = useState(0);
  const span = range.high - range.low;
  const width = Math.max(box, span * MIN_PX[band]);
  const plotH = height - AXIS - LABEL;
  const base = LABEL + plotH;
  const x = (mhz: number) => ((mhz - range.low) / span) * width;
  const h = (signal: number) => Math.min(1, Math.max(0.06, (signal - FLOOR) / (TOP - FLOOR))) * plotH;

  const trapezoid = (s: Span, top: number) => {
    const slope = Math.min(5, (s.high - s.low) / 4);
    const pts = [
      [x(s.low), base],
      [x(s.low + slope), base - top],
      [x(s.high - slope), base - top],
      [x(s.high), base],
    ];
    return pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('') + 'Z';
  };
  // Weak ones first, so strong networks are drawn on top.
  const sorted = [...networks].sort((a, b) => a.signal - b.signal);
  const labelled = sorted.filter((n) => (n.own || n.signal >= LABEL_FROM) && n.ssid);

  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)} testID={testID} accessibilityRole="image">
      {box > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={width > box} scrollEnabled={width > box}>
          <View style={{ width, height }}>
            <Svg width={width} height={height}>
              <Line x1={0} x2={width} y1={base} y2={base} stroke={colors.separator} strokeWidth={1} />
              {sorted.map((n) => (
                <Path
                  key={n.key}
                  d={trapezoid(n, h(n.signal))}
                  fill={n.own ? colors.accent : colors.textTertiary}
                  fillOpacity={n.own ? 0.35 : 0.14}
                  stroke={n.own ? colors.accent : colors.textSecondary}
                  strokeWidth={n.own ? 1.5 : 1}
                />
              ))}
              {self ? (
                <Path
                  d={trapezoid(self, plotH)}
                  fill={colors.accent}
                  fillOpacity={0.12}
                  stroke={colors.accent}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              ) : null}
              {target ? (
                <Path
                  d={trapezoid(target, plotH)}
                  fill={colors.success}
                  fillOpacity={0.12}
                  stroke={colors.success}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              ) : null}
            </Svg>
            {labelled.map((n) => {
              const w = Math.max(44, x(n.high) - x(n.low));
              return (
                <AppText
                  key={`l${n.key}`}
                  variant="caption"
                  tone={n.own ? 'accent' : 'secondary'}
                  numberOfLines={1}
                  style={[
                    styles.ssid,
                    { left: (x(n.low) + x(n.high)) / 2 - w / 2, width: w, top: base - h(n.signal) - LABEL },
                  ]}>
                  {n.ssid}
                </AppText>
              );
            })}
            {channels.map((c) => (
              <AppText
                key={c}
                variant="caption"
                tone="tertiary"
                style={[styles.tick, { left: x(channelFreq(band, c)) - 14, top: base + 3 }]}>
                {c}
              </AppText>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ssid: { position: 'absolute', textAlign: 'center' },
  tick: { position: 'absolute', width: 28, textAlign: 'center' },
});
