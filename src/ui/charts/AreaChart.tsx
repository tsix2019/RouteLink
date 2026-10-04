import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { RatePoint } from '@/api/services/traffic';

import { useTheme } from '../theme/ThemeProvider';
import { areaPath, niceMax } from './area-path';

/** Download/upload rate history; the y-axis scales to the larger series. */
export function TrafficChart({
  series,
  height = 120,
  capacity = 60,
}: {
  series: readonly RatePoint[];
  height?: number;
  capacity?: number;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  // Left-pad with zeros so the chart scrolls in from the right as samples arrive.
  const pad = Math.max(0, capacity - series.length);
  const down = [...Array<number>(pad).fill(0), ...series.map((p) => p.rxBps)];
  const up = [...Array<number>(pad).fill(0), ...series.map((p) => p.txBps)];
  const max = niceMax(Math.max(...down, ...up, 1));
  const d = areaPath(down, width, height, max);
  const u = areaPath(up, width, height, max);

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="image">
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="down" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.chartDown} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colors.chartDown} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="up" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.chartUp} stopOpacity={0.3} />
              <Stop offset="1" stopColor={colors.chartUp} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={d.area} fill="url(#down)" />
          <Path d={d.line} stroke={colors.chartDown} strokeWidth={2} fill="none" />
          <Path d={u.area} fill="url(#up)" />
          <Path d={u.line} stroke={colors.chartUp} strokeWidth={2} fill="none" />
        </Svg>
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.grid]} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.gridLine, { borderColor: colors.separator }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { justifyContent: 'space-between' },
  gridLine: { borderTopWidth: StyleSheet.hairlineWidth },
});
