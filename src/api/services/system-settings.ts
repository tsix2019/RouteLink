import type { RouterConnection } from '../connection/types';
import type { UbusCall, UbusResult } from '../ubus/types';
import { uci, type UciSection } from '../uci';
import { ActionError } from './action-error';

export interface Timezone {
  /** e.g. "Asia/Shanghai" */
  zonename: string;
  /** POSIX TZ string written to /etc/TZ, e.g. "CST-8" */
  tz: string;
}

export async function getTimezones(conn: RouterConnection): Promise<Timezone[]> {
  const raw = await conn.call<Record<string, { tzstring?: string }>>('luci', 'getTimezones');
  return Object.entries(raw ?? {})
    .map(([zonename, v]) => ({ zonename, tz: String(v?.tzstring ?? '') }))
    .filter((z) => z.tz)
    .sort((a, b) => a.zonename.localeCompare(b.zonename));
}

export interface TimeSettings {
  /** The uci `system` section. */
  section: string;
  zonename: string;
  /** Router clock, epoch seconds. */
  routerTime: number;
  /** Router minus phone, seconds. */
  offsetSec: number;
  ntp: boolean;
}

export async function getTimeSettings(
  conn: RouterConnection,
  phoneNowSec = Math.floor(Date.now() / 1000),
): Promise<TimeSettings> {
  const [system, time] = (await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'system' } },
    { object: 'luci', method: 'getLocaltime' },
  ])) as [UbusResult<{ values?: Record<string, UciSection> }>, UbusResult<{ result?: number }>];
  if (!system.ok) throw system.error;
  if (!time.ok) throw time.error;
  const sections = Object.values(system.data.values ?? {});
  const main = sections.find((s) => s['.type'] === 'system');
  const ntp = sections.find((s) => s['.type'] === 'timeserver');
  const routerTime = Number(time.data.result) || 0;
  return {
    section: main?.['.name'] ?? '@system[0]',
    zonename: String(main?.zonename ?? main?.timezone ?? 'UTC'),
    routerTime,
    offsetSec: routerTime - phoneNowSec,
    ntp: ntp?.enabled !== '0',
  };
}

/** Both options change together: LuCI writes the name and the POSIX string. */
export function timezoneChanges(section: string, zone: Timezone): UbusCall[] {
  return [uci.set('system', section, { zonename: zone.zonename, timezone: zone.tz })];
}

/** Sets the router clock to the phone's (routers without NTP or a battery-backed clock). */
export async function syncRouterClock(
  conn: RouterConnection,
  phoneNowSec = Math.floor(Date.now() / 1000),
): Promise<void> {
  await conn.call('luci', 'setLocaltime', { localtime: phoneNowSec });
}

export function validatePassword(password: string, repeat: string): 'empty' | 'mismatch' | 'weak' | null {
  if (!password) return 'empty';
  if (password !== repeat) return 'mismatch';
  if (password.length < 8) return 'weak';
  return null;
}

/** `luci setPassword` (LuCI's own password page). The caller then updates the stored password. */
export async function setAdminPassword(conn: RouterConnection, username: string, password: string): Promise<void> {
  const r = await conn.call<{ result?: boolean }>('luci', 'setPassword', { username, password });
  if (r?.result !== true) throw new ActionError('password-refused');
}
