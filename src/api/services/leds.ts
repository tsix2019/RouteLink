import type { RouterConnection } from '../connection/types';
import type { UbusCall, UbusResult } from '../ubus/types';
import { uci, type UciSection, type UciValues } from '../uci';

export interface Led {
  /** Kernel name, e.g. "green:wan". */
  sysfs: string;
  on: boolean;
  trigger: string;
  triggers: string[];
  /** uci system `led` section configuring it, if any. */
  section?: string;
  name?: string;
  /** netdev trigger: interface and what it shows. */
  dev?: string;
  mode?: string[];
}

export interface LedPatch {
  trigger: string;
  /** For the none trigger: steady on or off. */
  on?: boolean;
  dev?: string;
  mode?: string[];
}

type RawLed = { brightness?: number; triggers?: string[]; active_trigger?: string };

/** `luci getLEDs` (what the hardware offers) merged with the uci system `led` sections (what is configured). */
export async function getLeds(conn: RouterConnection): Promise<Led[]> {
  const [raw, system] = (await conn.batch([
    { object: 'luci', method: 'getLEDs' },
    { object: 'uci', method: 'get', params: { config: 'system' } },
  ])) as [UbusResult<Record<string, RawLed>>, UbusResult<{ values?: Record<string, UciSection> }>];
  if (!raw.ok) throw raw.error;
  const sections = Object.values(system.ok ? (system.data.values ?? {}) : {}).filter((s) => s['.type'] === 'led');
  return Object.entries(raw.data ?? {})
    .map(([sysfs, l]) => {
      const s = sections.find((x) => x.sysfs === sysfs);
      const led: Led = {
        sysfs,
        on: (l.brightness ?? 0) > 0,
        trigger: String(s?.trigger ?? l.active_trigger ?? 'none'),
        triggers: Array.isArray(l.triggers) ? l.triggers : [],
      };
      if (s) {
        led.section = s['.name'];
        if (typeof s.name === 'string') led.name = s.name;
        if (typeof s.dev === 'string') led.dev = s.dev;
        if (s.mode !== undefined) led.mode = String(s.mode).split(/\s+/).filter(Boolean);
      }
      return led;
    })
    .sort((a, b) => a.sysfs.localeCompare(b.sysfs));
}

/** LED settings don't cut connections: applied without a rollback timer. */
export function ledChanges(led: Led, patch: LedPatch): UbusCall[] {
  const values: UciValues = { trigger: patch.trigger };
  if (patch.trigger === 'none' && patch.on !== undefined) values.default = patch.on ? '1' : '0';
  if (patch.trigger === 'netdev') {
    if (patch.dev) values.dev = patch.dev;
    if (patch.mode) values.mode = patch.mode.join(' ');
  }
  if (led.section) return [uci.set('system', led.section, values)];
  return [uci.add('system', 'led', { name: led.sysfs, sysfs: led.sysfs, ...values })];
}
