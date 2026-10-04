import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useIsFocused, useNavigation, useRoute, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { GlassSurface } from './glass/GlassSurface';
import { Icon, type IconName } from './Icon';
import { useTabBarSpace } from './tabs/GlassTabBar';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Large title that collapses into the navigation bar. Omit inside sheets (no navigation bar). */
  title?: string;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  /** Inside a tab: leave room for the Android floating tab bar (iOS insets automatically). */
  inTabs?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rendered above the content, e.g. a connection banner. */
  top?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

const BAR_HEIGHT = 52;
/** iOS 26 has no hairline under the bar: content fades out under a soft edge instead. */
const EDGE = 28;

/** '#RRGGBB' + alpha → '#RRGGBBAA'. */
function withAlpha(hex: string, alpha: number) {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}

/**
 * Screen container. iOS: the native stack header (Liquid Glass on iOS 26) shows the title and items.
 * Android: an iOS 26–style bar drawn here — a large title in the content that, once scrolled away,
 * leaves a compact centred title on a glass bar; pushed screens get a round glass back button.
 */
export function Screen(props: ScreenProps) {
  if (Platform.OS === 'ios' || !props.title) return <NativeHeaderScreen {...props} />;
  return <GlassBarScreen {...props} />;
}

function NativeHeaderScreen({
  children,
  title,
  headerLeft,
  headerRight,
  inTabs = true,
  refreshing,
  onRefresh,
  top,
  contentStyle,
}: ScreenProps) {
  const { colors } = useTheme();
  const tabSpace = useTabBarSpace();
  const bottom = spacing.xl + (inTabs && Platform.OS === 'android' ? tabSpace : 0);
  return (
    <>
      {title ? (
        <Stack.Screen
          options={{
            title,
            headerLeft: headerLeft ? () => headerLeft : undefined,
            headerRight: headerRight ? () => headerRight : undefined,
          }}
        />
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: bottom }, contentStyle]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }>
        {top ? <View>{top}</View> : null}
        {children}
      </ScrollView>
    </>
  );
}

function GlassBarScreen({
  children,
  title,
  headerLeft,
  headerRight,
  inTabs = true,
  refreshing,
  onRefresh,
  top,
  contentStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const tabSpace = useTabBarSpace();
  const navigation = useNavigation();
  const router = useRouter();
  // Back button when this screen is not the first in its stack. Use our own position, not the stack's
  // index: the root screen also renders while a pushed screen is on top. useIsFocused re-renders us
  // when we come back into focus.
  const route = useRoute();
  useIsFocused();
  const canGoBack = (navigation.getState()?.routes.findIndex((r) => r.key === route.key) ?? 0) > 0;
  const barHeight = insets.top + BAR_HEIGHT;
  const bg = colors.background;

  // Like UINavigationBar: the compact title is centred on screen when it fits, otherwise it slides
  // towards the free side, and it only truncates when the space between the bar items runs out.
  const { width: screenW } = useWindowDimensions();
  const [sides, setSides] = useState({ left: 0, right: 0 });
  const [titleW, setTitleW] = useState(0);
  const minX = spacing.l + (sides.left ? sides.left + spacing.s : 0);
  const maxX = screenW - spacing.l - (sides.right ? sides.right + spacing.s : 0);
  const titleWidth = Math.min(titleW, Math.max(0, maxX - minX));
  const titleX = Math.min(Math.max((screenW - titleWidth) / 2, minX), maxX - titleWidth);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  const barBackground = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [4, 36], [0, 1], Extrapolation.CLAMP),
  }));
  const compactTitle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [28, 52], [0, 1], Extrapolation.CLAMP),
  }));
  const largeTitle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [0, 36], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(scrollY.get(), [-100, 0], [1.1, 1], Extrapolation.CLAMP) }],
  }));

  const left = canGoBack ? <BackButton onPress={() => router.back()} /> : headerLeft;

  return (
    <View style={styles.flex}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: barHeight, paddingBottom: spacing.xl + (inTabs ? tabSpace : 0) },
          contentStyle,
        ]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              progressViewOffset={barHeight}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }>
        <Animated.View style={[styles.largeTitle, largeTitle]}>
          <AppText variant="largeTitle" numberOfLines={1}>
            {title}
          </AppText>
        </Animated.View>
        {top ? <View>{top}</View> : null}
        {children}
      </Animated.ScrollView>

      <View style={[styles.bar, { height: barHeight + EDGE }]} pointerEvents="box-none">
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, barBackground]}>
          <LinearGradient
            colors={[withAlpha(bg, 0.97), withAlpha(bg, 0.9), withAlpha(bg, 0)]}
            locations={[0, barHeight / (barHeight + EDGE), 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View style={[styles.barRow, { marginTop: insets.top }]} pointerEvents="box-none">
          <AppText
            variant="headline"
            numberOfLines={1}
            style={styles.measure}
            onLayout={(e) => setTitleW(Math.ceil(e.nativeEvent.layout.width))}>
            {title}
          </AppText>
          <Animated.View
            pointerEvents="none"
            style={[styles.compactTitle, { left: titleX, width: titleWidth }, compactTitle]}>
            <AppText variant="headline" numberOfLines={1} align="center">
              {title}
            </AppText>
          </Animated.View>
          <View
            style={styles.side}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setSides((prev) => (prev.left === w ? prev : { ...prev, left: w }));
            }}>
            {left}
          </View>
          <View
            style={styles.side}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setSides((prev) => (prev.right === w ? prev : { ...prev, right: w }));
            }}>
            {headerRight}
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Round bar button. Android: a glass circle drawn here. iOS: a plain icon — the native header puts
 * bar items on Liquid Glass itself.
 */
export function HeaderButton({
  icon,
  onPress,
  accessibilityLabel,
  testID,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      testID={testID}>
      {Platform.OS === 'ios' ? (
        <View style={styles.back}>
          <Icon name={icon} size={20} color={colors.text} />
        </View>
      ) : (
        <GlassSurface variant="pill" interactive style={styles.back}>
          <Icon name={icon} size={22} color={colors.text} />
        </GlassSurface>
      )}
    </Pressable>
  );
}

/** iOS 26 back button: a round glass button with a chevron. */
export function BackButton({ onPress }: { onPress: () => void }) {
  return <HeaderButton icon="chevronLeft" onPress={onPress} accessibilityLabel="back" />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.l, gap: spacing.l },
  largeTitle: { transformOrigin: 'left center', marginBottom: -spacing.s },
  bar: { position: 'absolute', top: 0, left: 0, right: 0 },
  barRow: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
  },
  side: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  measure: { position: 'absolute', opacity: 0 },
  compactTitle: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
