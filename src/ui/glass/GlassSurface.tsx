import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { useBlurTarget } from './BlurTarget';
import { defaultRadius, type GlassSurfaceProps } from './types';

const CAN_BLUR = Platform.OS === 'android' && Number(Platform.Version) >= 31;

/**
 * Android (and fallback). Cards are plain grouped cells, as in iOS 26 Settings. Floating chrome —
 * capsules, the tab bar, sheets — imitates Liquid Glass: a light translucent fill with a soft
 * shadow, plus a real background blur on Android 12+ where a blur target exists.
 */
export function GlassSurface({ variant = 'card', tint, radius, style, children, ...rest }: GlassSurfaceProps) {
  const { scheme, colors, reduceTransparency } = useTheme();
  const target = useBlurTarget();
  const borderRadius = radius ?? defaultRadius(variant);
  const tintLayer = tint ? (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.14 }]} />
  ) : null;

  if (variant === 'card') {
    return (
      <View style={[styles.card, { borderRadius, backgroundColor: colors.card }, style]} {...rest}>
        {tintLayer}
        {children}
      </View>
    );
  }

  const blur = variant === 'floating' && CAN_BLUR && !reduceTransparency && !!target;
  return (
    <View
      style={[
        styles.glass,
        variant === 'floating' ? styles.floating : styles.pill,
        {
          borderRadius,
          borderColor: colors.glassBorder,
          backgroundColor: reduceTransparency ? colors.card : blur ? 'transparent' : colors.glassFillStrong,
          shadowColor: colors.shadow,
        },
        style,
      ]}
      {...rest}>
      {blur ? (
        <>
          <BlurView
            blurTarget={target}
            blurMethod="dimezisBlurView"
            intensity={45}
            tint={scheme}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill }]} />
        </>
      ) : null}
      {tintLayer}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  glass: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  pill: {
    elevation: 2,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  floating: {
    elevation: 10,
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
});
