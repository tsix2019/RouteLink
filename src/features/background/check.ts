import Storage from 'expo-sqlite/kv-store';
import RouteLinkNative from 'routelink-native';

import { LiveConnection } from '@/api/connection/live';
import type { RouterConnection } from '@/api/connection/types';
import { isConnectivityError } from '@/api/http/errors';
import { nativeHttpClient } from '@/api/http/native';
import { getClients } from '@/api/services/clients';
import { i18n, initI18n, setLanguage } from '@/i18n';
import { useRouters, type RouterProfile } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { useSnapshots } from '@/state/snapshots';
import { widgetProps } from '@/widgets/props';
import { showOnWidget } from '@/widgets/update';

import { compare, type Alert, type WatchMemory, type WatchReading } from './watch';

const MEMORY = 'routelink.watch';

export interface CheckDeps {
  /** How a watched router is reached: by default over HTTP with its saved password. */
  connect?: (profile: RouterProfile, password: string) => RouterConnection;
  notify(title: string, body: string): Promise<void>;
  /**
   * Waits before the second try of an unreachable router. JavaScript timers never fire when Android starts
   * the app headless for this task, so by default it waits natively.
   */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

async function loadMemory(): Promise<Record<string, WatchMemory>> {
  try {
    return JSON.parse((await Storage.getItem(MEMORY)) ?? '{}') as Record<string, WatchMemory>;
  } catch {
    return {};
  }
}

/** Two tries ten seconds apart before calling a router unreachable: one lost packet is not an outage. */
async function read(conn: RouterConnection, sleep: (ms: number) => Promise<void>): Promise<WatchReading> {
  for (let attempt = 0; ; attempt++) {
    try {
      const clients = await getClients(conn);
      return {
        reachable: true,
        devices: clients.map((c) => ({ mac: c.mac, name: c.name })),
        online: clients.filter((c) => c.online).length,
      };
    } catch (error) {
      if (!isConnectivityError(error)) return { reachable: true };
      if (attempt > 0) return { reachable: false };
      await sleep(10_000);
    }
  }
}

function message(alert: Alert, router: string): { title: string; body: string } {
  const t = i18n.t.bind(i18n);
  switch (alert.kind) {
    case 'offline':
      return { title: t('settings:notify.offlineTitle', { router }), body: t('settings:notify.offlineBody') };
    case 'online':
      return { title: t('settings:notify.onlineTitle', { router }), body: t('settings:notify.onlineBody') };
    case 'new-device':
      return {
        title: t('settings:notify.newDeviceTitle', { router }),
        body: t('settings:notify.newDeviceBody', { name: alert.name, mac: alert.mac }),
      };
  }
}

/**
 * One background round (design §19): every router with notifications on is read with its saved password;
 * alerts for what changed since last time; the widget gets the active router's fresh state.
 */
export async function checkRouters(deps: CheckDeps): Promise<{ checked: number; alerts: number }> {
  await Promise.all([
    useRouters.persist.rehydrate(),
    useSettings.persist.rehydrate(),
    useSnapshots.persist.rehydrate(),
  ]);
  // A headless start never ran the root layout: alerts still come in the user's language.
  initI18n('system');
  await setLanguage(useSettings.getState().language);
  const { routers, activeId, getPassword } = useRouters.getState();
  const watched = useSettings.getState().notifyRouters;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => RouteLinkNative.sleep(ms));
  const connect =
    deps.connect ??
    ((profile: RouterProfile, password: string) =>
      new LiveConnection({
        routerId: profile.id,
        baseUrl: profile.baseUrl,
        username: profile.username,
        password,
        authMode: profile.authMode,
        tlsSha256: profile.tlsSha256,
        http: nativeHttpClient,
      }));
  const memory = await loadMemory();
  let checked = 0;
  let sent = 0;
  for (const profile of routers.filter((r) => watched.includes(r.id))) {
    const password = await getPassword(profile.id);
    if (password === null) continue;
    const reading = await read(connect(profile, password), sleep);
    const { alerts, next } = compare(memory[profile.id], reading, now());
    memory[profile.id] = next;
    checked++;
    for (const alert of alerts) {
      const m = message(alert, profile.name);
      await deps.notify(m.title, m.body);
      sent++;
    }
    if (profile.id === activeId) {
      const snapshot = useSnapshots.getState().byRouter[profile.id];
      await showOnWidget(
        widgetProps(i18n.t.bind(i18n) as Parameters<typeof widgetProps>[0], {
          name: profile.name,
          online: reading.reachable,
          devicesOnline: reading.online ?? snapshot?.clientsOnline,
          updatedAt: now(),
        }),
      ).catch(() => undefined);
    }
  }
  await Storage.setItem(MEMORY, JSON.stringify(memory));
  return { checked, alerts: sent };
}
