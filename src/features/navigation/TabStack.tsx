import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { useTheme } from '@/ui/theme/ThemeProvider';

import { GlassHeader, type GlassHeaderProps } from './GlassHeader';

type StackOptions = NonNullable<ComponentProps<typeof Stack>['screenOptions']>;

/**
 * One stack per tab. iOS: native large-title header, transparent so iOS 26 renders its glass edge
 * effect. Android: a custom glass header. The tab root shows the router switcher on the left.
 */
export function TabStack({ title }: { title: string }) {
  const { colors } = useTheme();
  const common: StackOptions = { contentStyle: { backgroundColor: 'transparent' } };
  const screenOptions: StackOptions =
    Platform.OS === 'ios'
      ? {
          ...common,
          headerLargeTitle: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
          headerLargeTitleStyle: { color: colors.text },
        }
      : { ...common, header: (props) => <GlassHeader {...(props as unknown as GlassHeaderProps)} /> };

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title, headerLeft: () => <RouterSwitcherCapsule /> }} />
    </Stack>
  );
}
