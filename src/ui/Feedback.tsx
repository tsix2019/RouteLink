import { useEffect } from 'react';
import { Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useT } from '@/i18n';

import { AppText } from './AppText';
import { describeError } from './errorText';
import { GlassButton } from './GlassButton';
import { GlassSurface } from './glass/GlassSurface';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={44} color={colors.textTertiary} />
      <AppText variant="headline" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="subhead" tone="secondary" align="center">
          {message}
        </AppText>
      ) : null}
      {action ? <GlassButton label={action.label} onPress={action.onPress} compact /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const { title, detail } = describeError(t, error);
  return (
    <EmptyState
      icon="warning"
      title={title}
      message={detail}
      action={onRetry ? { label: t('retry'), onPress: onRetry } : undefined}
    />
  );
}

export function Skeleton({ width = '100%', height = 16, radius = 8 }: { width?: DimensionValue; height?: number; radius?: number }) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.separator }, animated]} />;
}

export type BannerTone = 'info' | 'warning' | 'error';

export function Banner({ tone = 'info', text, action }: { tone?: BannerTone; text: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  const color = { info: colors.accent, warning: colors.warning, error: colors.danger }[tone];
  return (
    <GlassSurface variant="card" radius={16} tint={color} style={styles.banner}>
      <Icon name={tone === 'info' ? 'info' : 'warning'} size={18} color={color} />
      <AppText variant="subhead" style={styles.bannerText}>
        {text}
      </AppText>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8}>
          <AppText variant="subhead" weight="600" style={{ color }}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.m, padding: spacing.xxl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingHorizontal: spacing.l, paddingVertical: spacing.m },
  bannerText: { flex: 1 },
});
