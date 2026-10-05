import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '../theme/ThemeProvider';
import { areaPath, niceMax } from './area-path';

/** A small line without axes (live rows): the last `capacity` values, scrolling in from the right. */
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
  const padded = [...Array<number>(Math.max(0, capacity - values.length)).fill(0), ...values.slice(-capacity)];
  const { line } = areaPath(padded, width, height - 2, niceMax(Math.max(1, ...padded)));
  return (
    <View
      style={{ width: fixedWidth, height, flex: fixedWidth ? undefined : 1 }}
      onLayout={fixedWidth ? undefined : (e) => setMeasured(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Path d={line} stroke={color ?? colors.chartDown} strokeWidth={1.5} fill="none" translateY={1} />
        </Svg>
      ) : null}
    </View>
  );
}
