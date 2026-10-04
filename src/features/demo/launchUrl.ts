import { Platform, Settings } from 'react-native';

/** Launch argument the iOS CI passes (`simctl launch … -RouteLinkLaunchURL routelink://demo?…`). */
const KEY = 'RouteLinkLaunchURL';

/**
 * iOS asks "Open in RouteLink?" when `simctl openurl` opens a custom scheme, which would stall the
 * CI. A launch argument lands in NSUserDefaults instead, so the CI starts the app with the link as
 * an argument. Only the demo and self-test links are honoured; returns the in-app path.
 */
export function launchUrlPath(read: (key: string) => unknown = (k) => Settings.get(k)): string | null {
  if (Platform.OS !== 'ios') return null;
  const url = read(KEY);
  if (typeof url !== 'string') return null;
  const m = /^routelink:\/\/(demo|selftest)(\?.*)?$/.exec(url);
  return m ? `/${m[1]}${m[2] ?? ''}` : null;
}
