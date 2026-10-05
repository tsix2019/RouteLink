import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { getDemoConnection } from '@/api/connection/manager';
import { getClients } from '@/api/services/clients';
import { deviceHref } from '@/features/devices/DeviceRow';
import { demoLanguage, safeDemoRoute } from '@/features/demo/route';
import { useSettings } from '@/state/settings';

/**
 * routelink://demo?lang=zh|en&theme=light|dark&route=/devices — turns on demo mode and opens a tab
 * screen (or, with route=/device, a demo device's sheet; see safeDemoRoute). Used by the screenshot scripts; harmless
 * for anyone else: it only shows the demo router.
 */
export default function DemoLink() {
  const router = useRouter();
  const set = useSettings((s) => s.set);
  const { lang, theme, route } = useLocalSearchParams<{ lang?: string; theme?: string; route?: string }>();

  useEffect(() => {
    const language = demoLanguage(lang);
    set({
      demoMode: true,
      ...(language ? { language } : {}),
      ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
    });
    const target = safeDemoRoute(route);
    if (target === '/device') {
      // The busiest online Wi-Fi device makes the most telling detail sheet.
      router.replace('/devices', { withAnchor: true });
      void getClients(getDemoConnection()).then((clients) => {
        const device = clients.find((c) => c.online && c.wifi);
        if (device) setTimeout(() => router.push(deviceHref(device.mac)), 400);
      });
      return;
    }
    if (target === '/traffic-live') {
      router.replace('/network/traffic?tab=live', { withAnchor: true });
      return;
    }
    if (target === '/traffic-device') {
      void getClients(getDemoConnection()).then((clients) => {
        const device = clients.find((c) => c.name === 'Living-Room-TV') ?? clients.find((c) => c.online);
        router.replace(device ? `/network/traffic/${encodeURIComponent(device.mac)}` : '/network/traffic', {
          withAnchor: true,
        });
      });
      return;
    }
    // withAnchor: a nested target (e.g. /wireless/scan) still gets its tab's root screen to go back to.
    router.replace(target as '/overview', { withAnchor: true });
  }, [lang, theme, route, set, router]);

  return null;
}
