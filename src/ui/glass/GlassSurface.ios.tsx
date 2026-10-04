import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { defaultRadius, type GlassSurfaceProps } from './types';

const LIQUID_GLASS = isLiquidGlassAvailable();

/**
 * Cards are plain grouped cells (iOS 26 keeps content solid). Floating chrome — capsules, toasts,
 * custom bars — is native Liquid Glass on iOS 26, system material blur before it, and opaque when
 * Reduce Transparency is on.
 */
export function GlassSurface({
  variant = 'card',
  interactive,
  tint,
  radius,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const { scheme, colors, reduceTransparency } = useTheme();
  const shape = { borderRadius: radius ?? defaultRadius(variant), overflow: 'hidden' as const };

  if (variant === 'card' || reduceTransparency) {
    return (
      <View style={[shape, { backgroundColor: colors.card }, style]} {...rest}>
        {tint ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.14 }]} />
        ) : null}
        {children}
      </View>
    );
  }
  if (LIQUID_GLASS) {
    // Never animate opacity on GlassView or a parent: the effect stops rendering at 0 (expo-glass-effect known issue).
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tint}
        colorScheme={scheme}
        style={[{ borderRadius: shape.borderRadius }, style]}
        {...rest}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      intensity={70}
      tint={scheme === 'dark' ? 'systemMaterialDark' : 'systemMaterialLight'}
      style={[shape, style]}
      {...rest}>
      {children}
    </BlurView>
  );
}
