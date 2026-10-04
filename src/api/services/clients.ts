import { isRandomizedMac, normalizeMac } from '@/utils/mac';
import { ipToInt, isIPv4, parseCidr } from '@/utils/net';
import { lookupVendor } from '@/utils/oui';

import type { RouterConnection } from '../connection/types';
import type { UciSection } from '../uci';
import type { UbusResult } from '../ubus/types';
import { parseInterfaces, pickWan } from './network';

export type Band = '2.4G' | '5G' | '6G';

export interface WifiIface {
  radio: string;
  section: string;
  ifname: string;
  ssid: string;
  band: Band;
}

export interface Station {
  mac: string;
  signal: number;
  inactiveMs: number;
  connectedSec?: number;
  /** kbit/s */
  rxRate?: number;
  txRate?: number;
}

export interface Neighbor {
  ip: string;
  mac: string;
  dev: string;
  state: string;
}

export interface Client {
  mac: string;
  /** What the UI shows: alias, hostname, vendor or MAC. */
  name: string;
  hostname?: string;
  /** Name stored on the router (dhcp host). */
  alias?: string;
  vendor: string | null;
  randomizedMac: boolean;
  ipv4?: string;
  ipv6: string[];
  online: boolean;
  onlineSource: 'wifi' | 'neighbor' | 'lease' | 'none';
  connection: 'wifi' | 'wired' | 'unknown';
  wifi?: { ifname: string; ssid: string; band: Band; signal: number; rxRate?: number; txRate?: number; connectedSec?: number };
  isStatic: boolean;
  staticIp?: string;
  /** dhcp host section holding this MAC (alias and/or static IP). */
  hostSection?: string;
  isBlocked: boolean;
  blockSection?: string;
  leaseExpiresSec?: number;
}

export interface ClientInputs {
  leases: { macaddr: string; ipaddr: string; hostname?: string; expires: number }[];
  hints: Record<string, { name?: string; ipaddrs?: string[]; ip6addrs?: string[] }>;
  stations: { iface: WifiIface; list: Station[] }[];
  dhcpHosts: UciSection[];
  firewallRules: UciSection[];
  /** undefined when the neighbour table is unavailable; online status then falls back to leases. */
  neighbors?: Neighbor[];
  /** The router's own interface MACs; never listed as clients. */
  ownMacs: Set<string>;
  /** IPv4 LAN subnets; hint/neighbour-only entries outside them (e.g. the ISP modem) are ignored. */
  lanSubnets: { network: number; prefix: number }[];
}

export const BLOCK_RULE_PREFIX = 'RouteLink: block ';
const ONLINE_STATES = new Set(['REACHABLE', 'STALE', 'DELAY', 'PROBE']);

const listOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s+/) : []).filter((s): s is string => !!s);

export function bandOf(config: { band?: string; hwmode?: string; channel?: string | number }): Band {
  if (config.band === '6g') return '6G';
  if (config.band === '5g' || config.hwmode === '11a') return '5G';
  if (config.band === '2g' || config.hwmode === '11g' || config.hwmode === '11b') return '2.4G';
  const ch = Number(config.channel);
  return Number.isFinite(ch) && ch > 14 ? '5G' : '2.4G';
}

interface RawRadio {
  config?: { band?: string; hwmode?: string; channel?: string | number };
  interfaces?: { section: string; ifname?: string; config?: { mode?: string; ssid?: string } }[];
}

/** Access-point interfaces from `luci-rpc getWirelessDevices`. */
export function parseWifiIfaces(radios: Record<string, RawRadio>): WifiIface[] {
  return Object.entries(radios).flatMap(([radio, r]) =>
    (r.interfaces ?? [])
      .filter((i) => i.ifname && (i.config?.mode ?? 'ap') === 'ap')
      .map((i) => ({ radio, section: i.section, ifname: i.ifname!, ssid: i.config?.ssid ?? '', band: bandOf(r.config ?? {}) })),
  );
}

export function parseStations(raw: { results?: Record<string, unknown>[] } | undefined): Station[] {
  return (raw?.results ?? []).map((s) => ({
    mac: String(s.mac),
    signal: Number(s.signal ?? 0),
    inactiveMs: Number(s.inactive ?? 0),
    connectedSec: s.connected_time === undefined ? undefined : Number(s.connected_time),
    rxRate: (s.rx as { rate?: number } | undefined)?.rate,
    txRate: (s.tx as { rate?: number } | undefined)?.rate,
  }));
}

/** `ip -4 neigh show` lines: "192.168.1.5 dev br-lan lladdr aa:bb:.. ref 1 used 0/0/0 probes 1 REACHABLE". */
export function parseNeighbors(stdout: string): Neighbor[] {
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((t) => t.length >= 3 && isIPv4(t[0]))
    .map((t) => {
      const at = (key: string) => {
        const i = t.indexOf(key);
        return i >= 0 ? t[i + 1] : undefined;
      };
      return { ip: t[0], dev: at('dev') ?? '', mac: at('lladdr') ?? '', state: t[t.length - 1].toUpperCase() };
    })
    .filter((n) => !!n.mac);
}

interface Draft {
  mac: string;
  leaseIp?: string;
  leaseName?: string;
  leaseExpires?: number;
  hintName?: string;
  hintIps: string[];
  ipv6: Set<string>;
  neighIp?: string;
  neighState?: string;
  wifi?: Client['wifi'];
  hostSection?: string;
  alias?: string;
  staticIp?: string;
  blockSection?: string;
}

const shortName = (name?: string) => (name ? name.split('.')[0] || undefined : undefined);

export function mergeClients(input: ClientInputs): Client[] {
  const drafts = new Map<string, Draft>();
  const draft = (raw: string): Draft | null => {
    const mac = normalizeMac(raw);
    if (!mac || input.ownMacs.has(mac)) return null;
    let d = drafts.get(mac);
    if (!d) {
      d = { mac, hintIps: [], ipv6: new Set() };
      drafts.set(mac, d);
    }
    return d;
  };
  const inLan = (ip?: string) => {
    if (!ip || !isIPv4(ip)) return false;
    if (input.lanSubnets.length === 0) return true;
    const n = ipToInt(ip);
    return input.lanSubnets.some(({ network, prefix }) => {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return ((n & mask) >>> 0) === network;
    });
  };

  for (const l of input.leases) {
    const d = draft(l.macaddr);
    if (!d) continue;
    d.leaseIp = l.ipaddr;
    if (l.hostname && l.hostname !== '*') d.leaseName = l.hostname;
    d.leaseExpires = l.expires;
  }
  for (const [mac, h] of Object.entries(input.hints)) {
    const d = draft(mac);
    if (!d) continue;
    d.hintName = h.name;
    d.hintIps = h.ipaddrs ?? [];
    (h.ip6addrs ?? []).forEach((a) => d.ipv6.add(a));
  }
  for (const n of input.neighbors ?? []) {
    const d = draft(n.mac);
    if (!d) continue;
    d.neighIp = n.ip;
    d.neighState = n.state;
  }
  for (const { iface, list } of input.stations) {
    for (const s of list) {
      const d = draft(s.mac);
      if (!d) continue;
      d.wifi = {
        ifname: iface.ifname,
        ssid: iface.ssid,
        band: iface.band,
        signal: s.signal,
        rxRate: s.rxRate,
        txRate: s.txRate,
        connectedSec: s.connectedSec,
      };
    }
  }
  for (const h of input.dhcpHosts) {
    for (const mac of listOf(h.mac)) {
      const d = draft(mac);
      if (!d) continue;
      d.hostSection = h['.name'];
      d.alias = typeof h.name === 'string' && h.name ? h.name : undefined;
      d.staticIp = typeof h.ip === 'string' && h.ip ? h.ip : undefined;
    }
  }
  for (const r of input.firewallRules) {
    if (!String(r.name ?? '').startsWith(BLOCK_RULE_PREFIX) || r.enabled === '0') continue;
    for (const mac of listOf(r.src_mac)) {
      const d = draft(mac);
      if (d) d.blockSection = r['.name'];
    }
  }

  const neighborsKnown = input.neighbors !== undefined;
  const clients = [...drafts.values()]
    .filter(
      (d) =>
        d.leaseIp || d.wifi || d.hostSection || d.blockSection || d.hintIps.some(inLan) || inLan(d.neighIp),
    )
    .map((d): Client => {
      const vendor = lookupVendor(d.mac);
      const hostname = shortName(d.leaseName ?? d.hintName);
      let online = false;
      let onlineSource: Client['onlineSource'] = 'none';
      if (d.wifi) {
        online = true;
        onlineSource = 'wifi';
      } else if (neighborsKnown) {
        if (d.neighState && ONLINE_STATES.has(d.neighState)) {
          online = true;
          onlineSource = 'neighbor';
        }
      } else if ((d.leaseExpires ?? 0) > 0) {
        online = true;
        onlineSource = 'lease';
      }
      return {
        mac: d.mac,
        name: d.alias ?? hostname ?? vendor ?? d.mac,
        hostname,
        alias: d.alias,
        vendor,
        randomizedMac: isRandomizedMac(d.mac),
        ipv4: d.leaseIp ?? d.hintIps.find(inLan) ?? d.hintIps[0] ?? d.neighIp ?? d.staticIp,
        ipv6: [...d.ipv6],
        online,
        onlineSource,
        connection: d.wifi ? 'wifi' : d.leaseIp || d.neighIp || d.hintIps.length ? 'wired' : 'unknown',
        wifi: d.wifi,
        isStatic: !!d.staticIp,
        staticIp: d.staticIp,
        hostSection: d.hostSection,
        isBlocked: !!d.blockSection,
        blockSection: d.blockSection,
        leaseExpiresSec: d.leaseExpires,
      };
    });

  return clients.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

const data = <T>(r: UbusResult | undefined): T | undefined => (r?.ok ? (r.data as T) : undefined);

const sectionsOfType = (values: Record<string, UciSection> | undefined, type: string): UciSection[] =>
  Object.values(values ?? {}).filter((s) => s['.type'] === type);

/** Two requests: everything static in one batch, then the station list of every access point. */
export async function getClients(conn: RouterConnection): Promise<Client[]> {
  const [leases, hints, wireless, dhcp, firewall, neigh, devices, ifaces] = await conn.batch([
    { object: 'luci-rpc', method: 'getDHCPLeases' },
    { object: 'luci-rpc', method: 'getHostHints' },
    { object: 'luci-rpc', method: 'getWirelessDevices' },
    { object: 'uci', method: 'get', params: { config: 'dhcp' } },
    { object: 'uci', method: 'get', params: { config: 'firewall' } },
    { object: 'file', method: 'exec', params: { command: '/sbin/ip', params: ['-4', 'neigh', 'show'] } },
    { object: 'luci-rpc', method: 'getNetworkDevices' },
    { object: 'network.interface', method: 'dump' },
  ]);
  if (!leases.ok) throw leases.error;

  const wifiIfaces = parseWifiIfaces(data<Record<string, RawRadio>>(wireless) ?? {});
  const assoc = wifiIfaces.length
    ? await conn.batch(wifiIfaces.map((w) => ({ object: 'iwinfo', method: 'assoclist', params: { device: w.ifname } })))
    : [];

  const neighOut = data<{ code?: number; stdout?: string }>(neigh);
  const ownMacs = new Set(
    Object.values(data<Record<string, { mac?: string }>>(devices) ?? {})
      .map((d) => (d.mac ? normalizeMac(d.mac) : null))
      .filter((m): m is string => !!m),
  );
  const interfaces = parseInterfaces(data<{ interface?: [] }>(ifaces)?.interface ?? []);
  const wan = pickWan(interfaces);
  const lanSubnets = interfaces
    .filter((i) => i !== wan && !i.hasDefaultRoute && i.name !== 'wan6')
    .flatMap((i) => i.ipv4.map((a) => parseCidr(`${a.address}/${a.mask}`)));

  const leaseData = leases.data as { dhcp_leases?: ClientInputs['leases'] };
  return mergeClients({
    leases: leaseData.dhcp_leases ?? [],
    hints: data<ClientInputs['hints']>(hints) ?? {},
    stations: wifiIfaces.map((iface, i) => ({ iface, list: parseStations(data(assoc[i])) })),
    dhcpHosts: sectionsOfType(data<{ values?: Record<string, UciSection> }>(dhcp)?.values, 'host'),
    firewallRules: sectionsOfType(data<{ values?: Record<string, UciSection> }>(firewall)?.values, 'rule'),
    neighbors: neighOut && neighOut.code === 0 ? parseNeighbors(neighOut.stdout ?? '') : undefined,
    ownMacs,
    lanSubnets,
  });
}
