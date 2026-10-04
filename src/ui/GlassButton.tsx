import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { GlassSurface } from './glass/GlassSurface';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme/ThemeProvider';
import { radius, spacing } from './theme/tokens';

export interface GlassButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'glass' | 'destructive' | 'warning';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GlassButton({
  label,
  onPress,
  variant = 'glass',
  icon,
  loading,
  disabled,
  compact,
  style,
  testID,
}: GlassButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const filled = variant !== 'glass';
  const background = { primary: colors.accent, destructive: colors.danger, warning: colors.warning, glass: undefined }[
    variant
  ];
  const foreground = filled ? colors.accentText : colors.accent;

  const content = (
    <View style={[styles.content, compact && styles.compact]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={foreground} /> : null}
          <AppText variant="headline" style={{ color: foreground }} numberOfLines={1}>
            {label}
          </AppText>
        </>
      )}
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      testID={testID}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [{ opacity: inactive ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
      {filled ? (
        <View style={[styles.filled, { backgroundColor: background }]}>{content}</View>
      ) : (
        <GlassSurface variant="pill" interactive radius={radius.button}>
          {content}
        </GlassSurface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filled: { borderRadius: radius.button, overflow: 'hidden' },
  content: {
    minHeight: 50,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
  },
  compact: { minHeight: 38, paddingHorizontal: spacing.l },
});
