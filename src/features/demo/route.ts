const TAB_PATH = /^\/(overview|devices|wireless|network|more)(\/[A-Za-z0-9%._-]+)*$/;

/**
 * Where a routelink://demo link may land: screens inside the tabs, plus "/device" (the detail sheet of
 * a demo device), "/traffic-device" (its traffic page), "/traffic-live" (live rates) and
 * "/device-schedule" (the internet-time page of the device that has one). The link is
 * for screenshots, so it never opens anything that changes a router.
 */
/** Screens that need a demo device or a tab chosen first; app/demo.tsx resolves them. */
const SPECIAL = ['/device', '/traffic-device', '/traffic-live', '/device-schedule'];

export function safeDemoRoute(route: string | undefined | null): string {
  if (!route) return '/overview';
  const special = route.startsWith('/') ? route : `/${route}`;
  if (SPECIAL.includes(special)) return special;
  const path = (route.startsWith('/') ? route : `/${route}`).replace(/^\/\(tabs\)(?=\/|$)/, '');
  const dotSegment = path.split('/').some((seg) => /^(\.|%2e)+$/i.test(seg));
  return TAB_PATH.test(path) && !dotSegment ? path : '/overview';
}

export type DemoLanguage = 'zh-CN' | 'en';

export const demoLanguage = (lang: string | undefined): DemoLanguage | undefined =>
  lang === 'zh' || lang === 'zh-CN' ? 'zh-CN' : lang === 'en' ? 'en' : undefined;
