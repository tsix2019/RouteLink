import RouteLinkNative from 'routelink-native';

import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import { getDemoConnection, getLiveConnection } from '@/api/connection/manager';
import type { RouterConnection } from '@/api/connection/types';
import { i18n, initI18n, setLanguage } from '@/i18n';
import { activeProfile, useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';

import type { WidgetData } from './data';
import { readWidgetData } from './read';

export interface WidgetTarget {
  id: string;
  name: string;
  /** null: the password is not saved, only the app can read this router. */
  connection: RouterConnection | null;
}

/**
 * A headless start (the widgets' task, the background check) never ran the root layout: the stores are
 * read from storage and the texts come in the user's language.
 */
export async function prepareHeadless(): Promise<void> {
  await Promise.all([
    useRouters.persist.hasHydrated() ? undefined : useRouters.persist.rehydrate(),
    useSettings.persist.hasHydrated() ? undefined : useSettings.persist.rehydrate(),
  ]);
  initI18n('system');
  await setLanguage(useSettings.getState().language);
}

/** The router the widgets follow, as the app would open it (demo mode first). */
export async function widgetTarget(): Promise<WidgetTarget | null> {
  if (useSettings.getState().demoMode) {
    return { id: DEMO_ROUTER_ID, name: i18n.t('demoRouter'), connection: getDemoConnection() };
  }
  const { routers, activeId, getPassword, update } = useRouters.getState();
  const profile = activeProfile(routers, activeId);
  if (!profile) return null;
  const password = await getPassword(profile.id);
  return {
    id: profile.id,
    name: profile.name,
    connection:
      password === null
        ? null
        : getLiveConnection(profile, password, (session) => {
            if (session.mode !== profile.authMode) void update(profile.id, { authMode: session.mode });
          }),
  };
}

let running: Promise<WidgetData | null> | null = null;

/**
 * Reads the widgets' router afresh. Null when there is none, or only the app can log in to it (no saved
 * password). Calls that come while one is running share it: every widget on the home screen asks at once.
 */
export function readForWidgets(sleep = (ms: number) => RouteLinkNative.sleep(ms)): Promise<WidgetData | null> {
  running ??= (async () => {
    try {
      await prepareHeadless();
      const target = await widgetTarget();
      if (!target?.connection) return null;
      const data = await readWidgetData(target.connection, target.name, sleep);
      return { ...data, refreshable: true };
    } finally {
      running = null;
    }
  })();
  return running;
}
