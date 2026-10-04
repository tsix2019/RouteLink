import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from './theme/ThemeProvider';

const SPRING = { damping: 22, stiffness: 220, mass: 0.9 } as const;

/**
 * Form-sheet screens. iOS uses the system sheet (Liquid Glass on iOS 26). Android has no equivalent,
 * so the route is a transparent modal and this draws an iOS 26–style floating glass sheet: inset,
 * large corner radius, grabber, dimmed backdrop, drag down or tap outside to dismiss.
 */
export function SheetScreen({ children, detent = 0.68 }: { children: ReactNode; detent?: number }) {
  if (Platform.OS === 'ios') return <>{children}</>;
  return <AndroidSheet detent={detent}>{children}</AndroidSheet>;
}

function AndroidSheet({ children, detent }: { children: ReactNode; detent: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  const sheetHeight = Math.min(height - insets.top - 12, Math.round(height * detent));
  const offset = useSharedValue(sheetHeight);
  const backdrop = useSharedValue(0);

  const close = () => router.back();
  const dismiss = () => {
    backdrop.set(withTiming(0, { duration: 180 }));
    offset.set(withTiming(sheetHeight, { duration: 220 }, (done) => done && runOnJS(close)()));
  };

  useEffect(() => {
    offset.set(withSpring(0, SPRING));
    backdrop.set(withTiming(1, { duration: 220 }));
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drag = Gesture.Pan()
    .activeOffsetY(8)
    .onChange((e) => offset.set(Math.max(0, offset.get() + e.changeY)))
    .onEnd((e) => {
      if (offset.get() > sheetHeight * 0.3 || e.velocityY > 900) runOnJS(dismiss)();
      else offset.set(withSpring(0, SPRING));
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.get() }));

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="close" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            height: sheetHeight,
            bottom: Math.max(insets.bottom, 8),
            backgroundColor: colors.background,
            borderColor: colors.glassBorder,
          },
          panelStyle,
        ]}>
        <GestureDetector gesture={drag}>
          <View style={styles.grabberArea}>
            <View style={[styles.grabber, { backgroundColor: colors.textTertiary }]} />
          </View>
        </GestureDetector>
        <View style={styles.content}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.32)' },
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
    elevation: 16,
  },
  grabberArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  grabber: { width: 36, height: 5, borderRadius: 3 },
  content: { flex: 1 },
});
