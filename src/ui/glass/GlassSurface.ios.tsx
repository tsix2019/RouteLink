import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { defaultRadius, type GlassSurfaceProps } from './types';

const LIQUID_GLASS = isLiquidGlassAvailable();

/** Native Liquid Glass on iOS 26; system material blur on older iOS; opaque when transparency is reduced. */
export function GlassSurface({ variant = 'card', interactive, tint, radius, style, children, ...rest }: GlassSurfaceProps) {
  const { scheme, colors, reduceTransparency } = useTheme();
  const shape = { borderRadius: radius ?? defaultRadius(variant), overflow: 'hidden' as const };

  if (reduceTransparency) {
    return (
      <View style={[shape, { backgroundColor: colors.glassFillStrong }, style]} {...rest}>
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
    <BlurView intensity={70} tint={scheme === 'dark' ? 'systemMaterialDark' : 'systemMaterialLight'} style={[shape, style]} {...rest}>
      {children}
    </BlurView>
  );
}
