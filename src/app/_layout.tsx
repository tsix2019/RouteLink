import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ActiveRouterProvider } from '@/features/routers/ActiveRouterProvider';
import { createQueryClient, useAppStateFocus } from '@/hooks/query-client';
import { i18n, initI18n, setLanguage } from '@/i18n';
import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { GradientBackground } from '@/ui/GradientBackground';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});
initI18n('system');

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const settingsReady = useSettings((s) => s.hydrated);
  const routersReady = useRouters((s) => s.hydrated);
  const language = useSettings((s) => s.language);
  const ready = settingsReady && routersReady;
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
                <RootStack />
              </ActiveRouterProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { scheme } = useTheme();
  return (
    <View style={styles.flex}>
      <GradientBackground />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.transparent }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="add-router" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="router-switcher"
          options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 1], sheetGrabberVisible: true, contentStyle: styles.transparent }}
        />
        <Stack.Screen name="trust-certificate" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="device/[mac]"
          options={{ presentation: 'formSheet', sheetAllowedDetents: [0.65, 1], sheetGrabberVisible: true, contentStyle: styles.transparent }}
        />
        <Stack.Screen name="reboot" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  transparent: { backgroundColor: 'transparent' },
});
