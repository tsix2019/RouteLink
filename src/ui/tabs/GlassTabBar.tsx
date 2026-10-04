import type { TabTriggerSlotProps } from 'expo-router/ui';
import { Children, createContext, forwardRef, useContext, useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type View as RNView, type ViewProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../AppText';
import { GlassSurface } from '../glass/GlassSurface';
import { Icon, type IconName } from '../Icon';
import { useTheme } from '../theme/ThemeProvider';

export const TAB_BAR_HEIGHT = 64;
const BAR_MARGIN = 16;
const BAR_PADDING = 6;

interface BarState {
  focused: SharedValue<number>;
}

const BarContext = createContext<BarState | null>(null);

/** Bottom padding screens need so the floating bar does not cover their last rows. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom + BAR_MARGIN + 8;
}

/** Floating capsule (Android). A glass "droplet" springs to the focused tab. */
export const GlassTabBar = forwardRef<RNView, ViewProps & { children: ReactNode }>(function GlassTabBar({ children, style, ...rest }, ref) {
  const insets = useSafeAreaInsets();
  const count = Children.count(children);
  const focused = useSharedValue(0);
  const segment = useSharedValue(0);

  const droplet = useAnimatedStyle(() => ({
    width: segment.get(),
    transform: [{ translateX: withSpring(focused.get() * segment.get(), { damping: 18, stiffness: 190, mass: 0.7 }) }],
  }));

  return (
    <BarContext.Provider value={{ focused }}>
      <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 8 }]}>
        <GlassSurface
          variant="floating"
          radius={TAB_BAR_HEIGHT / 2}
          style={styles.bar}
          onLayout={(e) => segment.set((e.nativeEvent.layout.width - BAR_PADDING * 2) / Math.max(1, count))}>
          <Animated.View style={[styles.droplet, droplet]} pointerEvents="none">
            <GlassSurface variant="pill" style={styles.dropletFill} />
          </Animated.View>
          <View ref={ref} style={[styles.row, style]} {...rest}>
            {children}
          </View>
        </GlassSurface>
      </View>
    </BarContext.Provider>
  );
});

type ButtonProps = TabTriggerSlotProps & { icon: IconName; label: string; index: number };

export const GlassTabButton = forwardRef<RNView, ButtonProps>(function GlassTabButton(
  // The trigger's own style would replace ours (row layout, no centring): drop it.
  { icon, label, index, isFocused, style: _triggerStyle, ...pressable },
  ref,
) {
  const { colors } = useTheme();
  const bar = useContext(BarContext);
  useEffect(() => {
    if (isFocused) bar?.focused.set(index);
  }, [isFocused, index, bar]);
  const color = isFocused ? colors.accent : colors.textSecondary;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      accessibilityLabel={label}
      style={styles.button}
      {...pressable}>
      <Icon name={icon} size={24} color={color} />
      <AppText variant="caption" weight={isFocused ? '600' : '400'} style={{ color, fontSize: 11 }} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: BAR_MARGIN, right: BAR_MARGIN },
  bar: { height: TAB_BAR_HEIGHT, padding: BAR_PADDING, justifyContent: 'center' },
  row: { flexDirection: 'row', flex: 1 },
  droplet: { position: 'absolute', top: BAR_PADDING, bottom: BAR_PADDING, left: BAR_PADDING },
  dropletFill: { flex: 1 },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
});
