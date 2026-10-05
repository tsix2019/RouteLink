import { isIPv4, parsePrefix } from '@/utils/net';

import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciSection, type UciValues } from '../uci';
import type { UbusCall } from '../ubus/types';
import { ActionError } from './action-error';
import { BLOCK_RULE_PREFIX } from './clients';

export interface FirewallZone {
  section: string;
  name: string;
  /** Interfaces (uci network names) in the zone. */
  networks: string[];
  input: string;
  output: string;
  forward: string;
  /** Masquerading: the zone faces the internet. */
  masq: boolean;
  mtuFix: boolean;
}

/** Traffic allowed from one zone to another. */
export interface ZoneForwarding {
  section: string;
  src: string;
  dest: string;
  enabled: boolean;
}

/** A `redirect` with target DNAT. Options the form doesn't show are listed in `extra` and kept on edits. */
export interface PortForward {
  section: string;
  name: string;
  protocols: string[];
  srcZone: string;
  /** Port or range ("8000-8100") on the router. */
  externalPort: string;
  destZone: string;
  internalIp: string;
  /** Unset: the same port as outside. */
  internalPort?: string;
  enabled: boolean;
  extra: string[];
}

export interface TrafficRule {
  section: string;
  name: string;
  /** Zone, "*" for any; unset means traffic from the router itself. */
  src?: string;
  /** Zone, "*" for any; unset means traffic to the router itself. */
  dest?: string;
  protocols: string[];
  srcIp: string[];
  destIp: string[];
  /** Ports and ranges, space separated. */
  destPort?: string;
  /** ACCEPT, REJECT, DROP, … */
  target: string;
  /** ipv4, ipv6; unset means both. */
  family?: string;
  enabled: boolean;
  /** The app's own device blocks (Devices tab): read-only here. */
  managed: boolean;
  extra: string[];
}

export interface Firewall {
  defaults: { input: string; output: string; forward: string };
  zones: FirewallZone[];
  forwardings: ZoneForwarding[];
  forwards: PortForward[];
  rules: TrafficRule[];
}

const FORWARD_OPTIONS = new Set([
  'name',
  'proto',
  'src',
  'src_dport',
  'dest',
  'dest_ip',
  'dest_port',
  'target',
  'enabled',
]);
const RULE_OPTIONS = new Set([
  'name',
  'src',
  'dest',
  'proto',
  'src_ip',
  'dest_ip',
  'dest_port',
  'target',
  'family',
  'enabled',
]);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
/** uci options may be lists or space-separated strings. */
const words = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).flatMap((x) => String(x).split(/\s+/)).filter(Boolean);
const extraOptions = (s: UciSection, known: Set<string>) =>
  Object.keys(s).filter((k) => !k.startsWith('.') && !known.has(k));
const byIndex = (a: UciSection, b: UciSection) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0);
const protocols = (v: unknown) => {
  const list = words(v).map((p) => p.toLowerCase());
  // fw4's default for rules and redirects.
  return list.length ? list : ['tcp', 'udp'];
};

export function parseFirewall(values: Record<string, UciSection>): Firewall {
  const all = Object.values(values).sort(byIndex);
  const of = (type: string) => all.filter((s) => s['.type'] === type);
  const defaults = of('defaults')[0];
  return {
    defaults: {
      input: String(defaults?.input ?? ''),
      output: String(defaults?.output ?? ''),
      forward: String(defaults?.forward ?? ''),
    },
    zones: of('zone').map((s) => ({
      section: s['.name'],
      name: String(s.name ?? ''),
      networks: words(s.network),
      input: String(s.input ?? 'DROP'),
      output: String(s.output ?? 'DROP'),
      forward: String(s.forward ?? 'DROP'),
      masq: s.masq === '1',
      mtuFix: s.mtu_fix === '1',
    })),
    forwardings: of('forwarding').map((s) => ({
      section: s['.name'],
      src: String(s.src ?? ''),
      dest: String(s.dest ?? ''),
      enabled: s.enabled !== '0',
    })),
    forwards: of('redirect')
      .filter((s) => String(s.target ?? 'DNAT').toUpperCase() === 'DNAT')
      .map((s) => {
        const f: PortForward = {
          section: s['.name'],
          name: String(s.name ?? ''),
          protocols: protocols(s.proto),
          srcZone: String(s.src ?? ''),
          externalPort: String(s.src_dport ?? ''),
          destZone: String(s.dest ?? ''),
          internalIp: String(s.dest_ip ?? ''),
          enabled: s.enabled !== '0',
          extra: extraOptions(s, FORWARD_OPTIONS),
        };
        const internal = str(s.dest_port);
        if (internal) f.internalPort = internal;
        return f;
      }),
    rules: of('rule').map((s) => {
      const name = String(s.name ?? '');
      const r: TrafficRule = {
        section: s['.name'],
        name,
        protocols: protocols(s.proto),
        srcIp: words(s.src_ip),
        destIp: words(s.dest_ip),
        target: String(s.target ?? 'DROP').toUpperCase(),
        enabled: s.enabled !== '0',
        managed: name.startsWith(BLOCK_RULE_PREFIX),
        extra: extraOptions(s, RULE_OPTIONS),
      };
      const src = str(s.src);
      const dest = str(s.dest);
      const destPort = words(s.dest_port).join(' ');
      const family = str(s.family);
      if (src) r.src = src;
      if (dest) r.dest = dest;
      if (destPort) r.destPort = destPort;
      if (family) r.family = family;
      return r;
    }),
  };
}

export async function getFirewall(conn: RouterConnection): Promise<Firewall> {
  return parseFirewall(await uci.get(conn, 'firewall'));
}

/** "80" or "8000-8100" → [first, last]; null when malformed. */
export function parsePortRange(text: string): [number, number] | null {
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(text.trim());
  if (!m) return null;
  const first = Number(m[1]);
  const last = m[2] === undefined ? first : Number(m[2]);
  return first >= 1 && last <= 65535 && first <= last ? [first, last] : null;
}

const validName = (name: string) => name.length <= 64 && !/[\r\n]/.test(name);

/** Form fields as typed. */
export interface PortForwardInput {
  name: string;
  protocols: ('tcp' | 'udp')[];
  srcZone: string;
  externalPort: string;
  destZone: string;
  internalIp: string;
  /** Empty: the same as outside. */
  internalPort: string;
}

export type ForwardFieldError =
  'name-invalid' | 'protocols-empty' | 'zone-missing' | 'port-invalid' | 'range-mismatch' | 'ip-invalid';

export function validatePortForward(
  input: PortForwardInput,
): Partial<Record<keyof PortForwardInput, ForwardFieldError>> {
  const errors: Partial<Record<keyof PortForwardInput, ForwardFieldError>> = {};
  if (!validName(input.name)) errors.name = 'name-invalid';
  if (!input.protocols.length) errors.protocols = 'protocols-empty';
  if (!input.srcZone) errors.srcZone = 'zone-missing';
  if (!input.destZone) errors.destZone = 'zone-missing';
  const external = parsePortRange(input.externalPort);
  if (!external) errors.externalPort = 'port-invalid';
  if (input.internalPort.trim()) {
    const internal = parsePortRange(input.internalPort);
    if (!internal) errors.internalPort = 'port-invalid';
    else if (external && internal[0] !== internal[1] && internal[1] - internal[0] !== external[1] - external[0]) {
      errors.internalPort = 'range-mismatch';
    }
  }
  if (!isIPv4(input.internalIp.trim())) errors.internalIp = 'ip-invalid';
  return errors;
}

/** Enabled forwards (other than `section`) that already take one of the external ports for a shared protocol. */
export function forwardConflicts(forwards: PortForward[], input: PortForwardInput, section?: string): PortForward[] {
  const wanted = parsePortRange(input.externalPort);
  if (!wanted) return [];
  return forwards.filter((f) => {
    const range = parsePortRange(f.externalPort);
    return (
      f.enabled &&
      f.section !== section &&
      f.srcZone === input.srcZone &&
      f.protocols.some((p) => (input.protocols as string[]).includes(p)) &&
      !!range &&
      range[0] <= wanted[1] &&
      wanted[0] <= range[1]
    );
  });
}

export function portForwardChanges(input: PortForwardInput, existing?: PortForward): UbusCall[] {
  const name = input.name.trim();
  const internalPort = input.internalPort.trim();
  const values: UciValues = {
    target: 'DNAT',
    src: input.srcZone,
    src_dport: input.externalPort.trim(),
    dest: input.destZone,
    dest_ip: input.internalIp.trim(),
    proto: input.protocols.join(' '),
  };
  if (name) values.name = name;
  if (internalPort) values.dest_port = internalPort;
  if (!existing) return [uci.add('firewall', 'redirect', values)];
  const calls = [uci.set('firewall', existing.section, values)];
  if (!name && existing.name) calls.push(uci.delOption('firewall', existing.section, 'name'));
  if (!internalPort && existing.internalPort) calls.push(uci.delOption('firewall', existing.section, 'dest_port'));
  return calls;
}

/** Port forwards and rules alike: `enabled 0` switches a section off. */
export const setEnabledChanges = (section: string, enabled: boolean): UbusCall[] => [
  uci.set('firewall', section, { enabled: enabled ? '1' : '0' }),
];

export const deleteSectionChanges = (section: string): UbusCall[] => [uci.del('firewall', section)];

export interface TrafficRuleInput {
  name: string;
  /** Zone, "*" for any, "" for the router itself. */
  src: string;
  /** Zone, "*" for any, "" for the router itself. */
  dest: string;
  /** tcp, udp, icmp, all, … */
  protocols: string[];
  /** Addresses or prefixes, space separated; empty for any. */
  srcIp: string;
  destIp: string;
  /** Ports and ranges, space separated; tcp and udp only. */
  destPort: string;
  target: 'ACCEPT' | 'REJECT' | 'DROP';
  /** "" for both. */
  family: '' | 'ipv4' | 'ipv6';
}

export type RuleFieldError =
  | 'name-invalid'
  | 'direction-invalid'
  | 'protocols-empty'
  | 'port-needs-tcp-udp'
  | 'port-invalid'
  | 'ip-invalid'
  | 'ip-family';

function addressError(text: string, family: TrafficRuleInput['family']): RuleFieldError | undefined {
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const p = parsePrefix(token);
    if (!p) return 'ip-invalid';
    if ((family === 'ipv4' && p.family !== 4) || (family === 'ipv6' && p.family !== 6)) return 'ip-family';
  }
  return undefined;
}

export function validateTrafficRule(input: TrafficRuleInput): Partial<Record<keyof TrafficRuleInput, RuleFieldError>> {
  const errors: Partial<Record<keyof TrafficRuleInput, RuleFieldError>> = {};
  if (!validName(input.name)) errors.name = 'name-invalid';
  if (!input.src && !input.dest) errors.dest = 'direction-invalid';
  if (!input.protocols.length) errors.protocols = 'protocols-empty';
  const ports = input.destPort.trim();
  if (ports) {
    if (!input.protocols.every((p) => p === 'tcp' || p === 'udp')) errors.destPort = 'port-needs-tcp-udp';
    else if (!ports.split(/\s+/).every((p) => parsePortRange(p))) errors.destPort = 'port-invalid';
  }
  const srcIp = addressError(input.srcIp, input.family);
  if (srcIp) errors.srcIp = srcIp;
  const destIp = addressError(input.destIp, input.family);
  if (destIp) errors.destIp = destIp;
  return errors;
}

const addressValue = (text: string): string | string[] => {
  const list = text.trim().split(/\s+/).filter(Boolean);
  return list.length === 1 ? list[0] : list;
};

export function trafficRuleChanges(input: TrafficRuleInput, existing?: TrafficRule): UbusCall[] {
  if (existing?.managed) throw new ActionError('rule-managed');
  const fields: Record<string, string | string[]> = {
    name: input.name.trim(),
    src: input.src,
    dest: input.dest,
    src_ip: addressValue(input.srcIp),
    dest_ip: addressValue(input.destIp),
    dest_port: input.destPort.trim().split(/\s+/).filter(Boolean).join(' '),
    family: input.family,
  };
  const values: UciValues = { proto: input.protocols.join(' '), target: input.target };
  for (const [key, value] of Object.entries(fields)) if (value.length) values[key] = value;
  if (!existing) return [uci.add('firewall', 'rule', values)];

  const had: Record<string, boolean> = {
    name: !!existing.name,
    src: existing.src !== undefined,
    dest: existing.dest !== undefined,
    src_ip: existing.srcIp.length > 0,
    dest_ip: existing.destIp.length > 0,
    dest_port: existing.destPort !== undefined,
    family: existing.family !== undefined,
  };
  const calls = [uci.set('firewall', existing.section, values)];
  for (const key of Object.keys(fields)) {
    if (values[key] === undefined && had[key]) calls.push(uci.delOption('firewall', existing.section, key));
  }
  return calls;
}

type Tuning = Omit<ApplyOptions, 'mode'>;

/** Firewall edits can lock the phone out: always with the rollback timer. */
export const applyFirewallChanges = (conn: RouterConnection, changes: UbusCall[], t?: Tuning): Promise<ApplyOutcome> =>
  stageAndApply(conn, changes, { mode: 'rollback', ...t });
