import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { useBlurTarget } from './BlurTarget';
import { defaultRadius, type GlassSurfaceProps } from './types';

const CAN_BLUR = Platform.OS === 'android' && Number(Platform.Version) >= 31;

/**
 * Android (and fallback) glass: translucent fill, top highlight and a light border. Floating surfaces
 * add a real background blur on Android 12+ when a blur target is available.
 */
export function GlassSurface({ variant = 'card', tint, radius, style, children, ...rest }: GlassSurfaceProps) {
  const { scheme, colors, reduceTransparency } = useTheme();
  const target = useBlurTarget();
  const blur = variant === 'floating' && CAN_BLUR && !reduceTransparency && !!target;
  const borderRadius = radius ?? defaultRadius(variant);

  return (
    <View
      style={[
        styles.base,
        {
          borderRadius,
          borderColor: colors.glassBorder,
          backgroundColor: reduceTransparency ? colors.glassFillStrong : blur ? 'transparent' : colors.glassFill,
          shadowColor: colors.shadow,
        },
        variant === 'floating' && styles.floating,
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
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill, opacity: 0.6 }]} />
        </>
      ) : null}
      {!reduceTransparency ? (
        <LinearGradient
          colors={[colors.glassHighlight, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.7 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {tint ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.16 }]} />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  floating: {
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
});
