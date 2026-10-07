import type { RouterConnection } from '@/api/connection/types';
import { stageAndApply, uci, type UciSection } from '@/api/uci';
import type { UbusCall } from '@/api/ubus/types';
import { normalizeMac } from '@/utils/mac';

/**
 * Trust list (design §17.3, plan P2 §0.7). With the plugin: `config device` sections of the gateway's
 * UCI `routelink` (unnamed; `mac`, `trusted`, `watch`), shared with LuCI and push notices. Without it:
 * the app's own list (state/trust.ts).
 */

export interface DeviceMark {
  mac: string;
  trusted: boolean;
  /** Push a notice when it comes and goes (plugin only). */
  watch: boolean;
  /** UCI section, when stored on the router. */
  section?: string;
}

const flag = (v: unknown) => v === '1' || v === 'true' || v === 'yes' || v === 'on';

export function parseDeviceMarks(values: Record<string, UciSection>): DeviceMark[] {
  const byMac = new Map<string, DeviceMark>();
  const sections = Object.values(values)
    .filter((s) => s['.type'] === 'device')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0));
  for (const s of sections) {
    const mac = normalizeMac(String(s.mac ?? ''));
    // Later sections for the same MAC win, as in the daemon.
    if (mac) byMac.set(mac, { mac, trusted: flag(s.trusted), watch: flag(s.watch), section: s['.name'] });
  }
  return [...byMac.values()];
}

export interface MarkUpdate {
  mac: string;
  trusted?: boolean;
  watch?: boolean;
}

/** uci calls turning `current` into `current` + `updates`; sections with neither flag left are deleted. */
export function markChanges(current: DeviceMark[], updates: MarkUpdate[]): UbusCall[] {
  const byMac = new Map(current.map((m) => [m.mac, m]));
  const calls: UbusCall[] = [];
  for (const u of updates) {
    const mac = normalizeMac(u.mac);
    if (!mac) continue;
    const old = byMac.get(mac);
    const trusted = u.trusted ?? old?.trusted ?? false;
    const watch = u.watch ?? old?.watch ?? false;
    if (old && old.trusted === trusted && old.watch === watch) continue;
    if (!old && !trusted && !watch) continue;
    if (old?.section) {
      calls.push(
        trusted || watch
          ? uci.set('routelink', old.section, { trusted: trusted ? '1' : '0', watch: watch ? '1' : '0' })
          : uci.del('routelink', old.section),
      );
    } else {
      calls.push(uci.add('routelink', 'device', { mac, trusted: trusted ? '1' : '0', watch: watch ? '1' : '0' }));
    }
    byMac.set(mac, { mac, trusted, watch, section: old?.section });
  }
  return calls;
}

export async function getDeviceMarks(conn: RouterConnection): Promise<DeviceMark[]> {
  return parseDeviceMarks(await uci.get(conn, 'routelink'));
}

/** Writes the marks and applies without rollback (design §7.2): nothing here can cut the phone off. */
export async function setDeviceMarks(conn: RouterConnection, updates: MarkUpdate[]): Promise<void> {
  const changes = markChanges(await getDeviceMarks(conn), updates);
  if (changes.length) await stageAndApply(conn, changes, { mode: 'direct' });
}

/** The local list's devices the router does not trust yet (moved over once the plugin is installed). */
export function migrationUpdates(local: string[], router: DeviceMark[]): MarkUpdate[] {
  const trusted = new Set(router.filter((m) => m.trusted).map((m) => m.mac));
  return local.filter((mac) => !trusted.has(mac)).map((mac) => ({ mac, trusted: true }));
}
