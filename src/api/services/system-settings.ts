import { posixOffsetAt } from '@/utils/posix-tz';

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
  /** Router clock, epoch seconds (UTC). */
  routerTime: number;
  /** The router's wall clock in its own zone, as seconds (format as UTC to show it). */
  localTime: number;
  /** Router minus phone, seconds. */
  offsetSec: number;
  ntp: boolean;
}

/**
 * LuCI's ACLs grant no clock call besides `system info`, which reports local wall-clock seconds; the
 * zone's POSIX string (uci system.timezone) turns them back into UTC.
 */
export async function getTimeSettings(
  conn: RouterConnection,
  phoneNowSec = Math.floor(Date.now() / 1000),
): Promise<TimeSettings> {
  const [system, info] = (await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'system' } },
    { object: 'system', method: 'info' },
  ])) as [UbusResult<{ values?: Record<string, UciSection> }>, UbusResult<{ localtime?: number }>];
  if (!system.ok) throw system.error;
  if (!info.ok) throw info.error;
  const sections = Object.values(system.data.values ?? {});
  const main = sections.find((s) => s['.type'] === 'system');
  const ntp = sections.find((s) => s['.type'] === 'timeserver');
  const local = Number(info.data.localtime) || 0;
  const routerTime = local - posixOffsetAt(String(main?.timezone ?? 'UTC'), phoneNowSec);
  return {
    section: main?.['.name'] ?? '@system[0]',
    zonename: String(main?.zonename ?? main?.timezone ?? 'UTC'),
    routerTime,
    localTime: local,
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
