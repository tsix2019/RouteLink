import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';

const SIZE = 132;
const PERIOD_MS = 1_800;

function Ring({ delay, color }: { delay: number; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: PERIOD_MS, easing: Easing.out(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - progress.value),
    transform: [{ scale: 0.35 + progress.value * 0.65 }],
  }));
  return <Animated.View style={[styles.ring, { borderColor: color, backgroundColor: `${color}22` }, style]} />;
}

/** Radar pulses around a Wi-Fi mark while the group's device lists are read (WF-3). */
export function ScanAnimation({ title, detail }: { title: string; detail?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={title}>
      <View style={styles.radar}>
        {[0, 1, 2].map((i) => (
          <Ring key={i} delay={(i * PERIOD_MS) / 3} color={colors.accent} />
        ))}
        <View style={[styles.core, { backgroundColor: colors.accent }]}>
          <Icon name="wifi" size={28} color={colors.accentText} />
        </View>
      </View>
      <AppText variant="headline" align="center">
        {title}
      </AppText>
      {detail ? (
        <AppText variant="subhead" tone="secondary" align="center">
          {detail}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.m, paddingVertical: spacing.xxl },
  radar: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 1.5 },
  core: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
