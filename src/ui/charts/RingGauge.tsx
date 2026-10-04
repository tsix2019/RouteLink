import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '../AppText';
import { useTheme } from '../theme/ThemeProvider';

/** Circular progress (0..1) with a big centre value and a caption below. */
export function RingGauge({
  value,
  label,
  centerText,
  size = 92,
  stroke = 9,
}: {
  value: number | null;
  label: string;
  centerText: string;
  size?: number;
  stroke?: number;
}) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value));
  const color = ratio > 0.85 ? colors.danger : ratio > 0.65 ? colors.warning : colors.accent;
  return (
    <View style={styles.wrap} accessibilityLabel={`${label} ${centerText}`}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.separator} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - ratio)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <AppText variant="headline">{centerText}</AppText>
        </View>
      </View>
      <AppText variant="footnote" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
