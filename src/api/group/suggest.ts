import type { RouterProfile } from '@/state/routers';

import type { RouterConnection } from '../connection/types';
import type { UbusResult } from '../ubus/types';
import { roleOf } from './members';

/**
 * Auto-suggestion when adding a router (design §14): offer to join it to a gateway's network group when
 * it has Wi-Fi and its default route points at a saved router, or when the plugin says it is an AP.
 */

export interface GroupHints {
  /** Next hop of its default route (IPv4), if any. */
  nexthop?: string;
  hasWifi: boolean;
  /** `routelink info.roles`, when the plugin answers. */
  pluginRoles?: string[];
}

const hostOf = (baseUrl: string) => {
  const m = /^[a-z]+:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(baseUrl);
  return m ? m[1].replace(/^\[|\]$/g, '') : baseUrl;
};

/** The gateway to suggest for router `self`, or undefined. */
export function suggestGateway(hints: GroupHints, routers: RouterProfile[], self: string): RouterProfile | undefined {
  const others = routers.filter((r) => r.id !== self && roleOf(r) !== 'ap');
  const upstream = hints.nexthop ? others.find((r) => hostOf(r.baseUrl) === hints.nexthop) : undefined;
  if (upstream && hints.hasWifi) return upstream;
  const pluginAp = !!hints.pluginRoles?.includes('ap') && !hints.pluginRoles.includes('gateway');
  if (!pluginAp) return undefined;
  if (upstream) return upstream;
  const gateways = others.filter((r) => roleOf(r) === 'gateway');
  return gateways.length === 1 ? gateways[0] : undefined;
}

interface RawIface {
  route?: { target?: string; mask?: number; nexthop?: string }[];
}

const data = <T>(r: UbusResult | undefined): T | undefined => (r?.ok ? (r.data as T) : undefined);

/** Reads the hints from a freshly added router (one batch; every part optional). */
export async function readGroupHints(conn: RouterConnection): Promise<GroupHints> {
  const [dump, wireless, info] = await conn.batch([
    { object: 'network.interface', method: 'dump' },
    { object: 'luci-rpc', method: 'getWirelessDevices' },
    { object: 'routelink', method: 'info' },
  ]);
  const ifaces = data<{ interface?: RawIface[] }>(dump)?.interface ?? [];
  const nexthop = ifaces
    .flatMap((i) => i.route ?? [])
    .find((r) => r.target === '0.0.0.0' && r.mask === 0 && r.nexthop && r.nexthop !== '0.0.0.0')?.nexthop;
  const radios = data<Record<string, unknown>>(wireless) ?? {};
  const roles = data<{ roles?: unknown }>(info)?.roles;
  return {
    nexthop,
    hasWifi: Object.keys(radios).length > 0,
    pluginRoles: Array.isArray(roles) ? roles.filter((x): x is string => typeof x === 'string') : undefined,
  };
}
