import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { demoLanguage, safeDemoRoute } from '@/features/demo/route';
import { useSettings } from '@/state/settings';

/**
 * routelink://demo?lang=zh|en&theme=light|dark&route=/devices — turns on demo mode and opens a tab
 * screen. Used by the screenshot scripts; harmless for anyone else (it only shows the demo router).
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
    // withAnchor: a nested target (e.g. /wireless/scan) still gets its tab's root screen to go back to.
    router.replace(safeDemoRoute(route) as '/overview', { withAnchor: true });
  }, [lang, theme, route, set, router]);

  return null;
}
