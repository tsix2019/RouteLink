import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';

import { useSettings } from '@/state/settings';

import { palettes, type Palette, type Scheme } from './tokens';

interface Theme {
  scheme: Scheme;
  colors: Palette;
  /** Draw glass as plain translucent fills: user setting (Android) or system accessibility setting. */
  reduceTransparency: boolean;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: palettes.light, reduceTransparency: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const preference = useSettings((s) => s.theme);
  const userReduce = useSettings((s) => s.reduceTransparency);
  const [systemReduce, setSystemReduce] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then(setSystemReduce)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setSystemReduce);
    return () => sub.remove();
  }, []);

  const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const theme = useMemo<Theme>(
    () => ({
      scheme,
      colors: palettes[scheme],
      reduceTransparency: systemReduce || (Platform.OS === 'android' && userReduce),
    }),
    [scheme, systemReduce, userReduce],
  );

  const navigation = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.accent,
        background: 'transparent',
        card: 'transparent',
        text: theme.colors.text,
      },
    };
  }, [scheme, theme.colors]);

  return (
    <ThemeContext.Provider value={theme}>
      <NavigationThemeProvider value={navigation}>{children}</NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

/**
 * Content of a sheet: iOS lifts sheets in dark mode (#1C1C1E) and their grouped cells one step
 * further (#2C2C2E), so cards stay distinguishable from the sheet behind them.
 */
export function ElevatedTheme({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const value = useMemo<Theme>(
    () => ({
      ...theme,
      colors: { ...theme.colors, background: theme.colors.sheet, card: theme.colors.sheetCard },
    }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
