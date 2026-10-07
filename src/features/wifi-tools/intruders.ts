import type { Client } from '@/api/services/clients';
import type { Radio, WifiNetwork } from '@/api/services/wireless';

import { findPhone } from './monitor';

/**
 * "Who is on my Wi-Fi" (design §17.3, WF-3): the group's online devices in a scope, the ones not on the
 * trust list first.
 */

/** The SSID the phone is on (every AP's network of that name), all Wi-Fi, or everything incl. wired. */
export type Scope = 'ssid' | 'wifi' | 'all';

export interface IntruderRow {
  client: Client;
  /** Not trusted, not the phone and not a router of the group. */
  stranger: boolean;
  trusted: boolean;
  phone: boolean;
  /** Name of the group router this device is (an AP shows up as a wired client of its gateway). */
  router?: string;
  random: boolean;
}

/** The network a client is on; for a client of an AP that does not answer, where it was last seen. */
export const ssidOf = (c: Client): string | undefined => c.wifi?.ssid ?? c.ap?.ssid;

/** The SSID the phone is connected to, when the phone is on the group's Wi-Fi. */
export function phoneSsid(clients: readonly Client[], phoneIp: string | null | undefined): string | undefined {
  const phone = findPhone(clients, phoneIp);
  return phone && phone.connection === 'wifi' ? ssidOf(phone) || undefined : undefined;
}

export const defaultScope = (ssid?: string): Scope => (ssid ? 'ssid' : 'wifi');

export function inScope(c: Client, scope: Scope, ssid?: string): boolean {
  if (!c.online) return false;
  if (scope === 'all') return true;
  if (c.connection !== 'wifi') return false;
  return scope === 'wifi' || (!!ssid && ssidOf(c) === ssid);
}

export interface RowContext {
  ssid?: string;
  trusted: ReadonlySet<string>;
  phoneIp?: string | null;
  /** IPv4 address → name of the routers of the group. */
  routers?: ReadonlyMap<string, string>;
}

const rank = (r: IntruderRow) => (r.stranger ? 0 : r.phone ? 1 : r.router ? 3 : 2);

/** Strangers first, then the phone, trusted devices and the group's own routers; by name within each. */
export function intruderRows(clients: readonly Client[], scope: Scope, ctx: RowContext): IntruderRow[] {
  const phone = findPhone(clients, ctx.phoneIp);
  return clients
    .filter((c) => inScope(c, scope, ctx.ssid))
    .map((c): IntruderRow => {
      const trusted = ctx.trusted.has(c.mac);
      const isPhone = c.mac === phone?.mac;
      const router = c.ipv4 ? ctx.routers?.get(c.ipv4) : undefined;
      return {
        client: c,
        stranger: !trusted && !isPhone && !router,
        trusted,
        phone: isPhone,
        router,
        random: c.randomizedMac,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.client.name.localeCompare(b.client.name));
}

export function intruderSummary(rows: readonly IntruderRow[]): { online: number; strangers: number } {
  return { online: rows.length, strangers: rows.filter((r) => r.stranger).length };
}

/** First use: nothing is trusted yet, so everything would show as a stranger. */
export const needsTrustSetup = (trusted: ReadonlySet<string>, rows: readonly IntruderRow[]) =>
  trusted.size === 0 && rows.some((r) => r.stranger);

/** What the "mark my devices" guide starts with ticked: the phone. */
export const initialSelection = (rows: readonly IntruderRow[]): Set<string> =>
  new Set(rows.filter((r) => r.phone).map((r) => r.client.mac));

/** The Wi-Fi network (uci section) a device is on, among the radios of the router it is associated with. */
export function networkFor(radios: readonly Radio[] | undefined, c: Client): WifiNetwork | undefined {
  const networks = (radios ?? []).flatMap((r) => r.networks);
  const ssid = ssidOf(c);
  return (
    networks.find((n) => !!c.wifi && n.ifname === c.wifi.ifname && n.ssid === c.wifi.ssid) ??
    (ssid ? networks.find((n) => n.ssid === ssid) : undefined)
  );
}

/** The edit page of that network; `router` when it belongs to an AP rather than the active router. */
export function networkHref(section: string, routerId?: string): string {
  const base = `/wireless/network/${encodeURIComponent(section)}`;
  return routerId ? `${base}?router=${encodeURIComponent(routerId)}` : base;
}
