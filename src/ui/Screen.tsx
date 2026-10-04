import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTabBarSpace } from './tabs/GlassTabBar';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export interface ScreenProps {
  children: ReactNode;
  /** Inside a tab: leave room for the Android floating tab bar (iOS insets automatically). */
  inTabs?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rendered above the scroll content, e.g. a connection banner. */
  top?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({ children, inTabs = true, refreshing, onRefresh, top, contentStyle }: ScreenProps) {
  const { colors } = useTheme();
  const tabSpace = useTabBarSpace();
  const bottom = spacing.xl + (inTabs && Platform.OS === 'android' ? tabSpace : 0);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { paddingBottom: bottom }, contentStyle]}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} /> : undefined
      }>
      {top ? <View>{top}</View> : null}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.l, gap: spacing.l },
});
