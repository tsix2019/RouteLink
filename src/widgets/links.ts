import { SHORTCUTS, WIDGET_LINKS } from './catalog';

/** Every link a widget opens, as the app's route: "routelink://wifi-qr" → "/wifi-qr". */
const ROUTES = new Set(
  [...Object.values(WIDGET_LINKS), ...SHORTCUTS.map((s) => s.uri), 'routelink://overview'].map((uri) =>
    uri.replace(/^routelink:\/\//, '/'),
  ),
);

/** Routes shown over the tabs: opened cold, they need the tabs underneath to go back to. */
const OVER_TABS = new Set(['/wifi-qr', '/terminal', '/assistant']);

/** The route of a link from a widget; null for any other link (the demo's, a typed one). */
export function widgetRoute(url: string): string | null {
  const m = /^routelink:\/\/([^?#]*)$/.exec(url);
  if (!m) return null;
  const route = `/${m[1].replace(/\/+$/, '')}`;
  return ROUTES.has(route) ? route : null;
}

let pending: string | null = null;

/**
 * A cold start on a sheet or full-screen page opens the overview instead, with the page to open over it
 * once the overview is up (takePendingRoute). Null for the other routes: they need nothing changed.
 */
export function coldStartRoute(route: string): string | null {
  if (!OVER_TABS.has(route)) return null;
  pending = route;
  return '/overview';
}

export function takePendingRoute(): string | null {
  const route = pending;
  pending = null;
  return route;
}
