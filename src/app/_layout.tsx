import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { createQueryClient, useAppStateFocus } from '@/hooks/query-client';
import { i18n, initI18n, setLanguage } from '@/i18n';
import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { FONT_ASSETS } from '@/ui/fonts';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';
import { ToastProvider } from '@/ui/Toast';

export { RouteErrorBoundary as ErrorBoundary } from '@/ui/RouteErrorBoundary';

SplashScreen.preventAutoHideAsync().catch(() => {});
initI18n('system');

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const settingsReady = useSettings((s) => s.hydrated);
  const routersReady = useRouters((s) => s.hydrated);
  const language = useSettings((s) => s.language);
  const [fontsReady, fontError] = useFonts(FONT_ASSETS);
  const ready = settingsReady && routersReady && (fontsReady || !!fontError);
  useAppStateFocus();

  useEffect(() => {
    if (settingsReady) void setLanguage(language);
  }, [settingsReady, language]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <ActiveRouterProvider>
                <ToastProvider>
                  <RootStack />
                </ToastProvider>
              </ActiveRouterProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Sheets: iOS gets the system form sheet (Liquid Glass on iOS 26). Android gets a transparent modal
 * in which SheetScreen draws an iOS 26–style floating sheet.
 */
const sheetOptions = (detents: number[]) =>
  Platform.OS === 'ios'
    ? {
        presentation: 'formSheet' as const,
        sheetAllowedDetents: detents,
        sheetGrabberVisible: true,
        contentStyle: styles.transparent,
      }
    : { presentation: 'transparentModal' as const, animation: 'none' as const, contentStyle: styles.transparent };

function RootStack() {
  const { scheme, colors } = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.transparent }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="demo" options={{ animation: 'none' }} />
        <Stack.Screen name="selftest" />
        <Stack.Screen name="add-router" options={{ presentation: 'modal' }} />
        <Stack.Screen name="router-switcher" options={sheetOptions([0.55, 1])} />
        <Stack.Screen name="trust-certificate" options={sheetOptions([0.8, 1])} />
        <Stack.Screen name="device/[mac]" options={sheetOptions([0.68, 1])} />
        <Stack.Screen name="wifi-qr" options={sheetOptions([0.85, 1])} />
        <Stack.Screen name="wireguard-export" options={sheetOptions([0.92, 1])} />
        <Stack.Screen name="reboot" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="maintenance" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  transparent: { backgroundColor: 'transparent' },
});
