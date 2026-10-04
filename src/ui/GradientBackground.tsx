import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from './theme/ThemeProvider';

/** Soft gradient with three colour blobs: glass needs something colourful to refract. */
export function GradientBackground() {
  const { colors } = useTheme();
  const blobs = [
    { id: 'b0', cx: '12%', cy: '8%', r: '55%', color: colors.blobs[0] },
    { id: 'b1', cx: '92%', cy: '42%', r: '50%', color: colors.blobs[1] },
    { id: 'b2', cx: '20%', cy: '92%', r: '55%', color: colors.blobs[2] },
  ];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={colors.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {blobs.map((b) => (
            <RadialGradient key={b.id} id={b.id} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={b.color} stopOpacity={1} />
              <Stop offset="1" stopColor={b.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {blobs.map((b) => (
          <Circle key={b.id} cx={b.cx} cy={b.cy} r={b.r} fill={`url(#${b.id})`} />
        ))}
      </Svg>
    </View>
  );
}
