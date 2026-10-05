import { normalizeMac } from '@/utils/mac';

import { uci, type UciSection } from '../uci';
import type { UbusCall } from '../ubus/types';

/** hostapd's MAC filter per access point (WL-6): off, only the listed devices, or all but them. */
export type MacFilterMode = 'disable' | 'allow' | 'deny';

export interface MacFilter {
  /** wifi-iface section */
  section: string;
  ssid: string;
  radio: string;
  mode: MacFilterMode;
  /** Upper case, colon separated. */
  macs: string[];
}

const MODES: MacFilterMode[] = ['disable', 'allow', 'deny'];

const macList = (v: unknown): string[] => {
  const raw = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s+/) : []).map(String);
  return [...new Set(raw.map((m) => normalizeMac(m)).filter((m): m is string => !!m))];
};

export function parseMacFilters(wireless: Record<string, UciSection>): MacFilter[] {
  return Object.values(wireless)
    .filter((s) => s['.type'] === 'wifi-iface' && (s.mode ?? 'ap') === 'ap')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0))
    .map((s) => ({
      section: s['.name'],
      ssid: String(s.ssid ?? ''),
      radio: String(s.device ?? ''),
      mode: MODES.includes(s.macfilter as MacFilterMode) ? (s.macfilter as MacFilterMode) : 'disable',
      macs: macList(s.maclist),
    }));
}

export type MacFilterError = 'mac-invalid' | 'allow-empty' | 'locks-out-phone';

/**
 * `phoneMac`: the address the router sees for this phone, when the phone is on this network — a list
 * that shuts it out would cut the app off the router.
 */
export function validateMacFilter(
  mode: MacFilterMode,
  macs: string[],
  o: { phoneMac?: string },
): MacFilterError | null {
  if (mode === 'disable') return null;
  if (macs.some((m) => !normalizeMac(m))) return 'mac-invalid';
  const list = macList(macs);
  if (mode === 'allow' && !list.length) return 'allow-empty';
  const phone = o.phoneMac ? normalizeMac(o.phoneMac) : null;
  if (phone && (mode === 'allow' ? !list.includes(phone) : list.includes(phone))) return 'locks-out-phone';
  return null;
}

/** Turning the filter off keeps the list, as LuCI does. */
export function macFilterChanges(filter: MacFilter, mode: MacFilterMode, macs: string[]): UbusCall[] {
  if (mode === 'disable') return [uci.set('wireless', filter.section, { macfilter: 'disable' })];
  return [uci.set('wireless', filter.section, { macfilter: mode, maclist: macList(macs) })];
}
