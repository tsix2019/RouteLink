import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import { useTheme } from '@/ui/theme/ThemeProvider';

type StackOptions = NonNullable<ComponentProps<typeof Stack>['screenOptions']>;

/**
 * A stack inside a tab or a modal. iOS: native large-title header, transparent so iOS 26 renders its glass edge
 * effect. Android: no native header — Screen draws an iOS 26–style bar. Titles and header items are
 * set by each screen through <Screen title headerLeft headerRight>.
 */
export function AppStack() {
  const { colors } = useTheme();
  const screenOptions: StackOptions =
    Platform.OS === 'ios'
      ? {
          contentStyle: { backgroundColor: 'transparent' },
          headerLargeTitle: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
          headerLargeTitleStyle: { color: colors.text },
        }
      : { contentStyle: { backgroundColor: 'transparent' }, headerShown: false, animation: 'slide_from_right' };
  return <Stack screenOptions={screenOptions} />;
}
