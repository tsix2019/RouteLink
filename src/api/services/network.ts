import type { RouterConnection } from '../connection/types';

export interface NetAddress {
  address: string;
  mask: number;
}

export interface NetInterface {
  name: string;
  proto: string;
  up: boolean;
  available: boolean;
  uptimeSec: number;
  /** Layer-3 device carrying the traffic (e.g. "pppoe-wan", "br-lan"). */
  device?: string;
  ipv4: NetAddress[];
  ipv6: NetAddress[];
  gateway?: string;
  dns: string[];
  /** Holds the IPv4 default route. */
  hasDefaultRoute: boolean;
  errors: string[];
}

interface RawInterface {
  interface: string;
  up?: boolean;
  available?: boolean;
  uptime?: number;
  proto?: string;
  device?: string;
  l3_device?: string;
  'ipv4-address'?: NetAddress[];
  'ipv6-address'?: NetAddress[];
  'ipv6-prefix-assignment'?: { address: string; mask: number; 'local-address'?: NetAddress }[];
  route?: { target: string; mask: number; nexthop?: string }[];
  'dns-server'?: string[];
  errors?: { code?: string }[];
}

export function parseInterfaces(raw: RawInterface[]): NetInterface[] {
  return raw
    .filter((i) => i.interface !== 'loopback')
    .map((i) => {
      const defaultRoute = i.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0);
      const assigned = (i['ipv6-prefix-assignment'] ?? [])
        .map((p) => p['local-address'])
        .filter((a): a is NetAddress => !!a);
      return {
        name: i.interface,
        proto: i.proto ?? 'none',
        up: i.up ?? false,
        available: i.available ?? true,
        uptimeSec: i.up ? (i.uptime ?? 0) : 0,
        device: i.l3_device ?? i.device,
        ipv4: i['ipv4-address'] ?? [],
        ipv6: [...(i['ipv6-address'] ?? []), ...assigned],
        gateway: defaultRoute?.nexthop,
        dns: i['dns-server'] ?? [],
        hasDefaultRoute: !!defaultRoute,
        errors: (i.errors ?? []).map((e) => e.code ?? 'UNKNOWN'),
      };
    });
}

export async function getInterfaces(conn: RouterConnection): Promise<NetInterface[]> {
  const r = await conn.call<{ interface?: RawInterface[] }>('network.interface', 'dump');
  return parseInterfaces(r.interface ?? []);
}

/** The interface named "wan", else whichever holds the default route. */
export const pickWan = (ifs: NetInterface[]): NetInterface | undefined =>
  ifs.find((i) => i.name === 'wan') ?? ifs.find((i) => i.hasDefaultRoute);

export interface DeviceCounters {
  rx: number;
  tx: number;
  up: boolean;
  mac?: string;
  speedMbps?: number;
}

export async function getDeviceCounters(conn: RouterConnection): Promise<Record<string, DeviceCounters>> {
  const raw = await conn.call<
    Record<string, { up?: boolean; mac?: string; stats?: { rx_bytes?: number; tx_bytes?: number }; link?: { speed?: number } }>
  >('luci-rpc', 'getNetworkDevices');
  const out: Record<string, DeviceCounters> = {};
  for (const [name, d] of Object.entries(raw)) {
    out[name] = {
      rx: d.stats?.rx_bytes ?? 0,
      tx: d.stats?.tx_bytes ?? 0,
      up: d.up ?? false,
      mac: d.mac,
      speedMbps: d.link?.speed && d.link.speed > 0 ? d.link.speed : undefined,
    };
  }
  return out;
}

/** Reconnect = ifdown + ifup (LuCI grants exec on both). */
export async function reconnectInterface(conn: RouterConnection, name: string): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`invalid interface name: ${name}`);
  await conn.call('file', 'exec', { command: '/sbin/ifdown', params: [name] });
  await conn.call('file', 'exec', { command: '/sbin/ifup', params: [name] });
}
