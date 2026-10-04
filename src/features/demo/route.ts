const TAB_PATH = /^\/(overview|devices|wireless|network|more)(\/[A-Za-z0-9%._-]+)*$/;

/**
 * Where a routelink://demo link may land: screens inside the tabs, plus "/device" (the detail sheet
 * of a demo device). The link is for screenshots, so it never opens anything that changes a router.
 */
export function safeDemoRoute(route: string | undefined | null): string {
  if (!route) return '/overview';
  if (route === '/device' || route === 'device') return '/device'; // a demo device's sheet, see app/demo.tsx
  const path = (route.startsWith('/') ? route : `/${route}`).replace(/^\/\(tabs\)(?=\/|$)/, '');
  const dotSegment = path.split('/').some((seg) => /^(\.|%2e)+$/i.test(seg));
  return TAB_PATH.test(path) && !dotSegment ? path : '/overview';
}

export type DemoLanguage = 'zh-CN' | 'en';

export const demoLanguage = (lang: string | undefined): DemoLanguage | undefined =>
  lang === 'zh' || lang === 'zh-CN' ? 'zh-CN' : lang === 'en' ? 'en' : undefined;
