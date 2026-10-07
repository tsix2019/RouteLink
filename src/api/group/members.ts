import type { RouterProfile, RouterRole } from '@/state/routers';

/** Network groups (design §14): one gateway and the OpenWrt access points behind it. */

export const roleOf = (r: Pick<RouterProfile, 'role'>): RouterRole => r.role ?? 'standalone';

/** The access points of a gateway, in the user's order. */
export function apsOf(routers: RouterProfile[], gatewayId: string): RouterProfile[] {
  return routers.filter((r) => roleOf(r) === 'ap' && r.gatewayId === gatewayId).sort((a, b) => a.order - b.order);
}

/** The gateway an access point belongs to, if it still exists. */
export function gatewayOf(routers: RouterProfile[], ap: RouterProfile): RouterProfile | undefined {
  if (roleOf(ap) !== 'ap' || !ap.gatewayId) return undefined;
  return routers.find((r) => r.id === ap.gatewayId && roleOf(r) === 'gateway');
}

export interface SwitcherEntry {
  router: RouterProfile;
  /** Access points shown indented under their gateway. */
  aps: RouterProfile[];
}

/**
 * The router switcher's list (NG-2): gateways and standalone routers at the top level, access points under
 * their gateway. An access point whose gateway is gone stays at the top level.
 */
export function switcherTree(routers: RouterProfile[]): SwitcherEntry[] {
  const sorted = [...routers].sort((a, b) => a.order - b.order);
  const nested = new Set<string>();
  const entries: SwitcherEntry[] = [];
  for (const r of sorted) {
    if (roleOf(r) !== 'gateway') continue;
    const aps = apsOf(sorted, r.id);
    aps.forEach((a) => nested.add(a.id));
  }
  for (const r of sorted) {
    if (nested.has(r.id)) continue;
    entries.push({ router: r, aps: roleOf(r) === 'gateway' ? apsOf(sorted, r.id) : [] });
  }
  return entries;
}

/** Gateways an access point can join: every gateway except itself. */
export const gatewayChoices = (routers: RouterProfile[], self?: string): RouterProfile[] =>
  routers.filter((r) => r.id !== self && roleOf(r) === 'gateway').sort((a, b) => a.order - b.order);
