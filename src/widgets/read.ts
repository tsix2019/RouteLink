import type { RouterConnection } from '@/api/connection/types';
import { isConnectivityError } from '@/api/http/errors';
import { getClients, type Client } from '@/api/services/clients';
import { getDeviceCounters, getInterfaces, pickWan } from '@/api/services/network';
import { getSystem, getTemperature, loadRatio } from '@/api/services/system';

import { DEVICE_NAMES, type WidgetData } from './data';

/** The rates come from two readings of the WAN counters this far apart. */
const SAMPLE_MS = 1_000;

const optional = <T>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Online devices for the widgets: counts, and a few names (Wi-Fi first: phones and laptops people know). */
export function deviceSummary(clients: readonly Client[]): Pick<
  WidgetData,
  'devicesOnline' | 'devicesTotal' | 'wifi' | 'wired' | 'deviceNames'
> {
  const online = clients.filter((c) => c.online);
  const wifi = online.filter((c) => c.connection === 'wifi');
  return {
    devicesOnline: online.length,
    devicesTotal: clients.length,
    wifi: wifi.length,
    wired: online.length - wifi.length,
    deviceNames: [...wifi, ...online.filter((c) => c.connection !== 'wifi')].slice(0, DEVICE_NAMES).map((c) => c.name),
  };
}

/**
 * Reads what the widgets show in one go (the ↻ button, the periodic update, the background check).
 * `sleep` waits natively: JavaScript timers do not run when Android starts the app headless.
 * An unreachable router comes back as offline; any other failure (a changed password) is thrown.
 */
export async function readWidgetData(
  conn: RouterConnection,
  name: string,
  sleep: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): Promise<WidgetData> {
  let system;
  try {
    system = await getSystem(conn);
  } catch (error) {
    if (isConnectivityError(error)) return { name, online: false, updatedAt: now() };
    throw error;
  }
  const first = now();
  const [interfaces, clients, counters, temperature] = await Promise.all([
    optional(getInterfaces(conn)),
    optional(getClients(conn)),
    optional(getDeviceCounters(conn)),
    getTemperature(conn),
  ]);
  const wan = interfaces ? pickWan(interfaces) : undefined;
  let rates: Pick<WidgetData, 'rxBps' | 'txBps'> = {};
  const before = wan?.device ? counters?.[wan.device] : undefined;
  if (wan?.device && before) {
    await sleep(SAMPLE_MS);
    const after = (await optional(getDeviceCounters(conn)))?.[wan.device];
    const dt = (now() - first) / 1000;
    if (after && dt > 0 && after.rx >= before.rx && after.tx >= before.tx) {
      rates = { rxBps: ((after.rx - before.rx) * 8) / dt, txBps: ((after.tx - before.tx) * 8) / dt };
    }
  }
  return {
    name,
    online: true,
    ...(clients ? deviceSummary(clients) : {}),
    ...rates,
    cpu: loadRatio(system) ?? undefined,
    memory: system.memory.total ? system.memory.used / system.memory.total : undefined,
    temperature: temperature ?? undefined,
    uptimeSec: system.uptimeSec,
    wanUp: wan?.up,
    wanIp: wan?.ipv4[0]?.address,
    wanProto: wan?.proto,
    updatedAt: now(),
  };
}
