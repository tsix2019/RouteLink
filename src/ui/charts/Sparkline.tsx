import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '../theme/ThemeProvider';
import { areaPath, niceMax } from './area-path';

/**
 * A small line without axes (live rows): the last `capacity` values, scrolling in from the right. Only real
 * samples are drawn — a fresh row shows a short line at the right edge, not a run of made-up zeros.
 */
export function Sparkline({
  values,
  capacity = 60,
  height = 26,
  width: fixedWidth,
  color,
}: {
  values: readonly number[];
  capacity?: number;
  height?: number;
  width?: number;
  color?: string;
}) {
  const { colors } = useTheme();
  const [measured, setMeasured] = useState(0);
  const width = fixedWidth ?? measured;
  const shown = values.slice(-capacity);
  // Each sample takes one of `capacity` slots; the newest sits at the right edge.
  const span = shown.length > 1 ? (width * (shown.length - 1)) / Math.max(1, capacity - 1) : 0;
  const { line } = areaPath(shown, span, height - 2, niceMax(Math.max(1, ...shown)));
  return (
    <View
      style={{ width: fixedWidth, height, flex: fixedWidth ? undefined : 1 }}
      onLayout={fixedWidth ? undefined : (e) => setMeasured(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Path
            d={line}
            stroke={color ?? colors.chartDown}
            strokeWidth={1.5}
            fill="none"
            translateX={width - span}
            translateY={1}
          />
        </Svg>
      ) : null}
    </View>
  );
}
