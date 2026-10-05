import { isIPv4, isIPv6, netmaskToPrefix, parsePrefix, prefixContains } from '@/utils/net';

import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciSection, type UciValues } from '../uci';
import type { UbusCall, UbusResult } from '../ubus/types';
import { ActionError } from './action-error';
import type { NetInterface } from './network';

export type Family = 4 | 6;

export interface NextHop {
  via?: string;
  dev?: string;
  weight?: number;
}

/** One line of `ip route show table all`. */
export interface KernelRoute {
  family: Family;
  /** unicast (when the output names none), local, broadcast, multicast, unreachable, blackhole, … */
  type: string;
  /** "default", a prefix, or a bare address for host routes. */
  target: string;
  /** Source prefix of IPv6 source-specific routes. */
  from?: string;
  via?: string;
  dev?: string;
  /** "main" when the output names none. */
  table: string;
  proto?: string;
  scope?: string;
  src?: string;
  metric?: number;
  /** Words without a value: onlink, linkdown, … */
  flags: string[];
  /** Multipath routes: one entry per "nexthop" line. */
  nexthops?: NextHop[];
}

const ROUTE_TYPES = new Set([
  'unicast',
  'local',
  'broadcast',
  'multicast',
  'anycast',
  'unreachable',
  'prohibit',
  'blackhole',
  'throw',
  'nat',
]);
const VALUE_WORDS = new Set([
  'via',
  'dev',
  'table',
  'proto',
  'scope',
  'src',
  'metric',
  'from',
  'pref',
  'expires',
  'mtu',
  'advmss',
  'hoplimit',
  'error',
  'nhid',
  'realms',
  'weight',
  'tos',
  'initcwnd',
  'initrwnd',
  'rtt',
  'rttvar',
  'ssthresh',
  'cwnd',
  'window',
  'congctl',
  'features',
  'quickack',
]);

function readWords(words: string[]): { values: Record<string, string>; flags: string[] } {
  const values: Record<string, string> = {};
  const flags: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!VALUE_WORDS.has(word) || i + 1 >= words.length) {
      flags.push(word);
      continue;
    }
    let value = words[++i];
    // "via inet6 fe80::1": an IPv4 route through an IPv6 gateway.
    if (word === 'via' && (value === 'inet' || value === 'inet6') && i + 1 < words.length) value = words[++i];
    values[word] = value;
  }
  return { values, flags };
}

/** Parses iproute2 and busybox `ip route` output; the "pref" and similar details are dropped. */
export function parseRoutes(text: string, family: Family): KernelRoute[] {
  const routes: KernelRoute[] = [];
  for (const line of text.split('\n')) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    if (words[0] === 'nexthop' && /^\s/.test(line)) {
      const last = routes[routes.length - 1];
      if (!last) continue;
      const { values } = readWords(words.slice(1));
      const hop: NextHop = {};
      if (values.via) hop.via = values.via;
      if (values.dev) hop.dev = values.dev;
      if (values.weight) hop.weight = Number(values.weight);
      (last.nexthops ??= []).push(hop);
      continue;
    }
    const typed = ROUTE_TYPES.has(words[0]);
    const target = words[typed ? 1 : 0];
    if (!target) continue;
    const { values, flags } = readWords(words.slice(typed ? 2 : 1));
    const route: KernelRoute = {
      family,
      type: typed ? words[0] : 'unicast',
      target,
      table: values.table ?? 'main',
      flags,
    };
    for (const key of ['from', 'via', 'dev', 'proto', 'scope', 'src'] as const) {
      if (values[key]) route[key] = values[key];
    }
    if (values.metric !== undefined && Number.isFinite(Number(values.metric))) route.metric = Number(values.metric);
    routes.push(route);
  }
  return routes;
}

/** A uci network `route` or `route6` section. Options keep their uci text so a form can edit them as is. */
export interface StaticRoute {
  section: string;
  family: Family;
  interface: string;
  /** Prefix; old-style sections with a separate netmask are shown as one prefix. */
  target: string;
  gateway?: string;
  metric?: string;
  table?: string;
  type?: string;
  /** Old-style netmask option, removed when the route is saved again. */
  netmask?: string;
  disabled: boolean;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function parseStaticRoutes(values: Record<string, UciSection>): StaticRoute[] {
  return Object.values(values)
    .filter((s) => s['.type'] === 'route' || s['.type'] === 'route6')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0))
    .map((s) => {
      const family: Family = s['.type'] === 'route6' ? 6 : 4;
      let target = text(s.target) ?? '';
      const netmask = text(s.netmask);
      if (family === 4 && netmask && !target.includes('/')) {
        try {
          target = `${target}/${netmaskToPrefix(netmask)}`;
        } catch {
          // A broken netmask stays visible as it is written.
        }
      }
      const route: StaticRoute = {
        section: s['.name'],
        family,
        interface: text(s.interface) ?? '',
        target,
        disabled: s.disabled === '1',
      };
      for (const key of ['gateway', 'metric', 'table', 'type', 'netmask'] as const) {
        const value = text(s[key]);
        if (value) route[key] = value;
      }
      return route;
    });
}

export interface Routes {
  kernel: KernelRoute[];
  statics: StaticRoute[];
}

type ExecOutput = { code?: number; stdout?: string };

const ipRoute = (flag: '-4' | '-6'): UbusCall => ({
  object: 'file',
  method: 'exec',
  // These exact arguments are what LuCI's ACL grants.
  params: { command: '/sbin/ip', params: [flag, 'route', 'show', 'table', 'all'] },
});

export async function getRoutes(conn: RouterConnection): Promise<Routes> {
  const [v4, v6, network] = (await conn.batch([
    ipRoute('-4'),
    ipRoute('-6'),
    { object: 'uci', method: 'get', params: { config: 'network' } },
  ])) as [UbusResult<ExecOutput>, UbusResult<ExecOutput>, UbusResult<{ values?: Record<string, UciSection> }>];
  if (!v4.ok) throw v4.error;
  if (!network.ok) throw network.error;
  // `ip -6` fails on kernels with IPv6 switched off: there is simply nothing to show.
  const read = (r: UbusResult<ExecOutput>, family: Family) =>
    r.ok && r.data.code === 0 ? parseRoutes(r.data.stdout ?? '', family) : [];
  return { kernel: [...read(v4, 4), ...read(v6, 6)], statics: parseStaticRoutes(network.data.values ?? {}) };
}

/** Form fields as typed; empty optional fields mean "not set". */
export interface StaticRouteInput {
  family: Family;
  interface: string;
  target: string;
  gateway: string;
  metric: string;
  table: string;
}

export type RouteFieldError =
  'interface-missing' | 'target-invalid' | 'gateway-invalid' | 'gateway-outside' | 'metric-invalid' | 'table-invalid';

const isLinkLocal = (ip: string) => parsePrefix(ip) !== null && prefixContains('fe80::/10', ip);

/**
 * Field errors (empty when valid). `iface` is the interface's runtime state: its addresses tell
 * whether the gateway is reachable directly; without addresses (interface down) that can't be checked.
 */
export function validateStaticRoute(
  input: StaticRouteInput,
  iface: NetInterface | undefined,
): Partial<Record<keyof StaticRouteInput, RouteFieldError>> {
  const errors: Partial<Record<keyof StaticRouteInput, RouteFieldError>> = {};
  if (!input.interface.trim()) errors.interface = 'interface-missing';
  const target = parsePrefix(input.target);
  if (!target || target.family !== input.family) errors.target = 'target-invalid';

  const gateway = input.gateway.trim();
  if (gateway) {
    const valid = input.family === 4 ? isIPv4(gateway) : isIPv6(gateway);
    if (!valid) errors.gateway = 'gateway-invalid';
    else if (iface && !(input.family === 6 && isLinkLocal(gateway))) {
      const own = input.family === 4 ? iface.ipv4 : iface.ipv6;
      if (own.length && !own.some((a) => prefixContains(`${a.address}/${a.mask}`, gateway))) {
        errors.gateway = 'gateway-outside';
      }
    }
  }

  const metric = input.metric.trim();
  if (metric && !(/^\d{1,10}$/.test(metric) && Number(metric) <= 0xffffffff)) errors.metric = 'metric-invalid';
  const table = input.table.trim();
  if (table && !/^[A-Za-z0-9_-]{1,32}$/.test(table)) errors.table = 'table-invalid';
  return errors;
}

const OPTIONAL = ['gateway', 'metric', 'table'] as const;

/** Adds or edits a static route. The target is written as its network address, as netifd would install it. */
export function staticRouteChanges(input: StaticRouteInput, existing?: StaticRoute): UbusCall[] {
  const target = parsePrefix(input.target);
  if (!target || target.family !== input.family || (existing && existing.family !== input.family)) {
    throw new ActionError('route-invalid');
  }
  const values: UciValues = { interface: input.interface.trim(), target: `${target.network}/${target.prefix}` };
  for (const key of OPTIONAL) {
    const value = input[key].trim();
    if (value) values[key] = value;
  }
  if (!existing) return [uci.add('network', input.family === 4 ? 'route' : 'route6', values)];
  const calls = [uci.set('network', existing.section, values)];
  for (const key of OPTIONAL) {
    if (!values[key] && existing[key] !== undefined) calls.push(uci.delOption('network', existing.section, key));
  }
  if (existing.netmask !== undefined) calls.push(uci.delOption('network', existing.section, 'netmask'));
  return calls;
}

export const deleteStaticRouteChanges = (route: StaticRoute): UbusCall[] => [uci.del('network', route.section)];

type Tuning = Omit<ApplyOptions, 'mode'>;

/** Route changes can cut the phone off (a bad default route): applied with the rollback timer. */
export const saveStaticRoute = (
  conn: RouterConnection,
  input: StaticRouteInput,
  existing?: StaticRoute,
  t?: Tuning,
): Promise<ApplyOutcome> => stageAndApply(conn, staticRouteChanges(input, existing), { mode: 'rollback', ...t });

export const deleteStaticRoute = (conn: RouterConnection, route: StaticRoute, t?: Tuning): Promise<ApplyOutcome> =>
  stageAndApply(conn, deleteStaticRouteChanges(route), { mode: 'rollback', ...t });
