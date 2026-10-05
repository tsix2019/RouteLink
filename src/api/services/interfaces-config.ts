import { intToIp, ipToInt, isIPv4, isIPv6, netmaskToPrefix, parsePrefix, prefixContains } from '@/utils/net';

import type { RouterConnection } from '../connection/types';
import { uci, type UciSection, type UciValues } from '../uci';
import type { UbusCall, UbusResult } from '../ubus/types';

export type WanProto = 'dhcp' | 'static' | 'pppoe';
export const WAN_PROTOS: WanProto[] = ['dhcp', 'static', 'pppoe'];

/** The uci `wan` interface as the WAN form shows it. */
export interface WanConfig {
  section: string;
  /** Anything else (dhcpv6, qmi, wireguard, …) is shown but not edited here. */
  proto: string;
  device?: string;
  ipaddr?: string;
  netmask?: string;
  gateway?: string;
  /** Static address stored as a CIDR list (25.12 style) instead of ipaddr + netmask. */
  cidrList?: boolean;
  username?: string;
  password?: string;
  /** Own DNS servers; empty means the ones the ISP hands out. */
  dns: string[];
  mtu?: string;
  /** Options present in the section, to know what to remove when the protocol changes. */
  options: string[];
}

export interface DhcpPool {
  section: string;
  enabled: boolean;
  /** Offset of the first address from the network address. */
  start: number;
  limit: number;
  leasetime: string;
}

export interface LanConfig {
  ipaddr: string;
  prefix: number;
  /** How the address is stored: ipaddr + netmask (up to 24.10) or a CIDR list (25.12). */
  style: 'netmask' | 'cidr-list' | 'cidr';
  dhcp?: DhcpPool;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).flatMap((x) => String(x).split(/\s+/)).filter(Boolean);
const maskOf = (prefix: number) => intToIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

/** First IPv4 address of an interface section, whichever way it is written. */
function address(s: UciSection): { ipaddr: string; prefix: number; style: LanConfig['style'] } | undefined {
  const first = list(s.ipaddr)[0];
  if (!first) return undefined;
  const style: LanConfig['style'] = Array.isArray(s.ipaddr) ? 'cidr-list' : first.includes('/') ? 'cidr' : 'netmask';
  if (first.includes('/')) {
    const p = parsePrefix(first);
    return p && p.family === 4 ? { ipaddr: p.address, prefix: p.prefix, style } : undefined;
  }
  let prefix = 32;
  try {
    if (typeof s.netmask === 'string') prefix = netmaskToPrefix(s.netmask);
  } catch {
    // a broken netmask leaves a host address
  }
  return isIPv4(first) ? { ipaddr: first, prefix, style } : undefined;
}

export function parseLanWan(
  network: Record<string, UciSection>,
  dhcp: Record<string, UciSection>,
): { lan?: LanConfig; wan?: WanConfig } {
  const out: { lan?: LanConfig; wan?: WanConfig } = {};
  const lanSection = network.lan;
  const lanAddress = lanSection ? address(lanSection) : undefined;
  if (lanAddress) {
    out.lan = { ...lanAddress };
    const pool = Object.values(dhcp).find((s) => s['.type'] === 'dhcp' && s.interface === 'lan');
    if (pool) {
      out.lan.dhcp = {
        section: pool['.name'],
        enabled: pool.ignore !== '1',
        start: Number(pool.start ?? 100) || 100,
        limit: Number(pool.limit ?? 150) || 150,
        leasetime: String(pool.leasetime ?? '12h'),
      };
    }
  }
  const w = network.wan;
  if (w && w['.type'] === 'interface') {
    const wan: WanConfig = {
      section: w['.name'],
      proto: String(w.proto ?? 'none'),
      dns: list(w.dns),
      options: Object.keys(w).filter((k) => !k.startsWith('.')),
    };
    for (const key of ['device', 'gateway', 'username', 'password', 'mtu'] as const) {
      const value = text(w[key]);
      if (value) wan[key] = value;
    }
    const a = address(w);
    if (a) {
      wan.ipaddr = a.ipaddr;
      wan.netmask = maskOf(a.prefix);
      if (a.style !== 'netmask') wan.cidrList = true;
    }
    out.wan = wan;
  }
  return out;
}

export async function getLanWan(
  conn: RouterConnection,
): Promise<{ lan?: LanConfig; wan?: WanConfig; dhcpValues: Record<string, UciSection> }> {
  const [network, dhcp] = (await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'network' } },
    { object: 'uci', method: 'get', params: { config: 'dhcp' } },
  ])) as UbusResult<{ values?: Record<string, UciSection> }>[];
  if (!network.ok) throw network.error;
  const dhcpValues = dhcp.ok ? (dhcp.data.values ?? {}) : {};
  return { ...parseLanWan(network.data.values ?? {}, dhcpValues), dhcpValues };
}

/** Form fields as typed. */
export interface WanInput {
  proto: WanProto;
  ipaddr: string;
  netmask: string;
  gateway: string;
  username: string;
  password: string;
  /** Own DNS servers, separated by spaces or commas; empty for the ISP's. */
  dns: string;
  /** Empty for the default. */
  mtu: string;
}

export type WanFieldError =
  | 'ip-invalid'
  | 'netmask-invalid'
  | 'gateway-outside'
  | 'overlaps-lan'
  | 'username-missing'
  | 'dns-invalid'
  | 'mtu-invalid';

const dnsList = (s: string) => s.split(/[\s,]+/).filter(Boolean);

function prefixOf(mask: string): number | null {
  try {
    return isIPv4(mask) ? netmaskToPrefix(mask) : null;
  } catch {
    return null;
  }
}

/** Neither the network nor the broadcast address of its subnet (prefixes up to /30). */
function hostAddress(ip: string, prefix: number): boolean {
  if (prefix > 30) return true;
  const n = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (n & ~mask) >>> 0 !== 0 && (n | ~mask) >>> 0 !== n;
}

const overlaps = (a: { ipaddr: string; prefix: number }, b: { ipaddr: string; prefix: number }) => {
  const shorter = Math.min(a.prefix, b.prefix);
  return prefixContains(`${a.ipaddr}/${shorter}`, b.ipaddr);
};

export function validateWan(
  input: WanInput,
  lan: { ipaddr: string; prefix: number } | undefined,
): Partial<Record<keyof WanInput, WanFieldError>> {
  const errors: Partial<Record<keyof WanInput, WanFieldError>> = {};
  if (input.proto === 'static') {
    const prefix = prefixOf(input.netmask.trim());
    const ip = input.ipaddr.trim();
    if (prefix === null || prefix < 1) errors.netmask = 'netmask-invalid';
    if (!isIPv4(ip) || (prefix !== null && !hostAddress(ip, prefix))) errors.ipaddr = 'ip-invalid';
    else if (prefix !== null && lan && overlaps({ ipaddr: ip, prefix }, lan)) errors.ipaddr = 'overlaps-lan';
    const gw = input.gateway.trim();
    if (!errors.ipaddr && prefix !== null && (!isIPv4(gw) || gw === ip || !prefixContains(`${ip}/${prefix}`, gw))) {
      errors.gateway = 'gateway-outside';
    }
  }
  if (input.proto === 'pppoe' && !input.username.trim()) errors.username = 'username-missing';
  if (!dnsList(input.dns).every((d) => isIPv4(d) || isIPv6(d))) errors.dns = 'dns-invalid';
  const mtu = input.mtu.trim();
  if (mtu && !(/^\d+$/.test(mtu) && Number(mtu) >= 576 && Number(mtu) <= 9200)) errors.mtu = 'mtu-invalid';
  return errors;
}

/** Whether saving the form would change anything. */
export function wanChanged(input: WanInput, wan: WanConfig): boolean {
  const same = (a: string, b: string | undefined) => a.trim() === (b ?? '');
  if (input.proto !== wan.proto) return true;
  if (
    input.proto === 'static' &&
    !(same(input.ipaddr, wan.ipaddr) && same(input.netmask, wan.netmask) && same(input.gateway, wan.gateway))
  ) {
    return true;
  }
  if (input.proto === 'pppoe' && !(same(input.username, wan.username) && input.password === (wan.password ?? ''))) {
    return true;
  }
  return dnsList(input.dns).join(' ') !== wan.dns.join(' ') || !same(input.mtu, wan.mtu);
}

/** Options that belong to one protocol only: dropped when switching to another. */
const PROTO_OPTIONS: Record<WanProto, string[]> = {
  dhcp: ['hostname', 'clientid', 'vendorid', 'broadcast'],
  static: ['ipaddr', 'netmask', 'gateway', 'broadcast'],
  pppoe: ['username', 'password', 'ac', 'service', 'keepalive', 'pppd_options'],
};

export function wanChanges(input: WanInput, current: WanConfig): UbusCall[] {
  const values: UciValues = { proto: input.proto };
  const remove = new Set<string>();
  for (const [proto, options] of Object.entries(PROTO_OPTIONS)) {
    if (proto !== input.proto) options.forEach((o) => remove.add(o));
  }
  if (input.proto === 'static') {
    const prefix = prefixOf(input.netmask.trim()) ?? 32;
    if (current.cidrList) {
      values.ipaddr = [`${input.ipaddr.trim()}/${prefix}`];
      remove.add('netmask');
    } else {
      values.ipaddr = input.ipaddr.trim();
      values.netmask = maskOf(prefix);
    }
    values.gateway = input.gateway.trim();
  }
  if (input.proto === 'pppoe') {
    values.username = input.username.trim();
    values.password = input.password;
  }
  const dns = dnsList(input.dns);
  if (dns.length) {
    // DHCP and PPPoE would add the ISP's servers too unless told not to.
    if (input.proto !== 'static') values.peerdns = '0';
    else remove.add('peerdns');
    values.dns = dns;
  } else {
    remove.add('peerdns');
    remove.add('dns');
  }
  const mtu = input.mtu.trim();
  if (mtu) values.mtu = mtu;
  else remove.add('mtu');

  const calls = [uci.set('network', current.section, values)];
  for (const option of current.options) {
    if (remove.has(option) && values[option] === undefined)
      calls.push(uci.delOption('network', current.section, option));
  }
  return calls;
}

export interface LanInput {
  ipaddr: string;
  netmask: string;
  /** DHCP server on the LAN. */
  dhcp: boolean;
  start: string;
  limit: string;
  leasetime: string;
}

export type LanFieldError =
  | 'ip-invalid'
  | 'netmask-invalid'
  | 'overlaps-wan'
  | 'start-invalid'
  | 'limit-invalid'
  | 'pool-outside'
  | 'leasetime-invalid';

const LEASETIME = /^(\d+)([smhdw]?)$/;
const SECONDS: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** `wan` is the WAN's current address, so the LAN doesn't take the same subnet. */
export function validateLan(
  input: LanInput,
  wan: { ipaddr: string; prefix: number } | undefined,
): Partial<Record<keyof LanInput, LanFieldError>> {
  const errors: Partial<Record<keyof LanInput, LanFieldError>> = {};
  const prefix = prefixOf(input.netmask.trim());
  const ip = input.ipaddr.trim();
  if (prefix === null || prefix < 8 || prefix > 30) errors.netmask = 'netmask-invalid';
  if (!isIPv4(ip) || (prefix !== null && !hostAddress(ip, prefix))) errors.ipaddr = 'ip-invalid';
  else if (prefix !== null && wan && overlaps({ ipaddr: ip, prefix }, wan)) errors.ipaddr = 'overlaps-wan';
  if (!input.dhcp) return errors;

  const start = Number(input.start);
  const limit = Number(input.limit);
  if (!/^\d+$/.test(input.start.trim()) || start < 1) errors.start = 'start-invalid';
  if (!/^\d+$/.test(input.limit.trim()) || limit < 1) errors.limit = 'limit-invalid';
  if (!errors.start && !errors.limit && prefix !== null && !errors.netmask) {
    // The pool counts from the network address and must stay below the broadcast address.
    if (start + limit - 1 > 2 ** (32 - prefix) - 2) errors.limit = 'pool-outside';
  }
  const lease = LEASETIME.exec(input.leasetime.trim());
  // dnsmasq refuses leases under two minutes.
  if (input.leasetime.trim() !== 'infinite' && (!lease || Number(lease[1]) * SECONDS[lease[2]] < 120)) {
    errors.leasetime = 'leasetime-invalid';
  }
  return errors;
}

export function lanChanges(input: LanInput, current: LanConfig): UbusCall[] {
  const calls: UbusCall[] = [];
  const ip = input.ipaddr.trim();
  const prefix = prefixOf(input.netmask.trim()) ?? current.prefix;
  if (ip !== current.ipaddr || prefix !== current.prefix) {
    const values: UciValues =
      current.style === 'cidr-list'
        ? { ipaddr: [`${ip}/${prefix}`] }
        : current.style === 'cidr'
          ? { ipaddr: `${ip}/${prefix}` }
          : { ipaddr: ip, netmask: maskOf(prefix) };
    calls.push(uci.set('network', 'lan', values));
  }
  const pool = current.dhcp;
  if (!pool) return calls;
  if (!input.dhcp) {
    if (pool.enabled) calls.push(uci.set('dhcp', pool.section, { ignore: '1' }));
    return calls;
  }
  const values: UciValues = {};
  if (Number(input.start) !== pool.start) values.start = input.start.trim();
  if (Number(input.limit) !== pool.limit) values.limit = input.limit.trim();
  if (input.leasetime.trim() !== pool.leasetime) values.leasetime = input.leasetime.trim();
  if (!pool.enabled) values.ignore = '0';
  if (Object.keys(values).length) calls.push(uci.set('dhcp', pool.section, values));
  return calls;
}

/** Static leases (dhcp `host` sections) whose address would fall outside the new LAN subnet. */
export function leasesOutside(
  dhcp: Record<string, UciSection>,
  ipaddr: string,
  prefix: number,
): { name: string; ip: string }[] {
  return Object.values(dhcp)
    .filter((s) => s['.type'] === 'host' && typeof s.ip === 'string' && isIPv4(s.ip))
    .filter((s) => !prefixContains(`${ipaddr}/${prefix}`, String(s.ip)))
    .map((s) => ({ name: String(s.name ?? s.mac ?? s['.name']), ip: String(s.ip) }));
}
