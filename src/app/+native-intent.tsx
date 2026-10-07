import { coldStartRoute, widgetRoute } from '@/widgets/links';

/**
 * Links from the home-screen widgets (design §19). Opened cold, Expo Router would show a sheet (Wi-Fi QR)
 * or a full-screen page (terminal, assistant) with nothing underneath to go back to: those open over the
 * overview instead. With the app already open, and for any other link, Expo Router's own handling stays.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const route = initial ? widgetRoute(path) : null;
    return (route && coldStartRoute(route)) ?? path;
  } catch {
    return path;
  }
}
