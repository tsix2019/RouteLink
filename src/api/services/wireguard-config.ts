import { isIPv6, parsePrefix, prefixContains } from '@/utils/net';

import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciSection, type UciValues } from '../uci';
import type { UbusCall } from '../ubus/types';
import { ActionError } from './action-error';
import { takenSubnets } from './guest';
import { parseWgInstances } from './wireguard';

/** NW-8: WireGuard interfaces and peers as LuCI's luci-proto-wireguard stores them in uci network. */

export const WG_RULE_PREFIX = 'RouteLink: WireGuard ';

export interface WgConfigPeer {
  section: string;
  name: string;
  publicKey: string;
  /** Kept on the router (as LuCI does) when the router generated the peer's keys: needed for the export. */
  privateKey?: string;
  presharedKey?: string;
  allowedIps: string[];
  endpointHost?: string;
  endpointPort?: string;
  keepalive?: string;
  routeAllowedIps: boolean;
  disabled: boolean;
}

export interface WgConfigInterface {
  name: string;
  privateKey: string;
  listenPort?: string;
  addresses: string[];
  mtu?: string;
  peers: WgConfigPeer[];
  /** Firewall zone the interface is in. */
  zone?: string;
  zoneSection?: string;
  /** The rule the app added to open the listen port on the WAN. */
  portRule?: string;
}

const words = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).flatMap((x) => String(x).split(/[\s,]+/)).filter(Boolean);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const byIndex = (a: UciSection, b: UciSection) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0);
const ofType = (values: Record<string, UciSection>, type: string) =>
  Object.values(values)
    .filter((s) => s['.type'] === type)
    .sort(byIndex);

/** A Curve25519 key in base64: 32 bytes, so 43 characters and "=", the last one with its low bits clear. */
export const isWgKey = (key: string) => /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/.test(key);

export function parseWgConfig(
  network: Record<string, UciSection>,
  firewall: Record<string, UciSection>,
): WgConfigInterface[] {
  const zones = ofType(firewall, 'zone');
  const rules = ofType(firewall, 'rule');
  return ofType(network, 'interface')
    .filter((s) => s.proto === 'wireguard')
    .map((s) => {
      const name = s['.name'];
      const iface: WgConfigInterface = {
        name,
        privateKey: String(s.private_key ?? ''),
        addresses: words(s.addresses),
        peers: ofType(network, `wireguard_${name}`).map((p) => {
          const peer: WgConfigPeer = {
            section: p['.name'],
            name: String(p.description ?? ''),
            publicKey: String(p.public_key ?? ''),
            allowedIps: words(p.allowed_ips),
            routeAllowedIps: p.route_allowed_ips === '1',
            disabled: p.disabled === '1',
          };
          const optional = {
            privateKey: str(p.private_key),
            presharedKey: str(p.preshared_key),
            endpointHost: str(p.endpoint_host),
            endpointPort: str(p.endpoint_port),
            keepalive: str(p.persistent_keepalive),
          };
          for (const [k, v] of Object.entries(optional)) if (v) Object.assign(peer, { [k]: v });
          return peer;
        }),
      };
      const port = str(s.listen_port);
      const mtu = str(s.mtu);
      if (port) iface.listenPort = port;
      if (mtu) iface.mtu = mtu;
      const zone = zones.find((z) => words(z.network).includes(name));
      if (zone) {
        iface.zone = String(zone.name ?? zone['.name']);
        iface.zoneSection = zone['.name'];
      }
      const rule = rules.find((r) => r.name === `${WG_RULE_PREFIX}${name}`);
      if (rule) iface.portRule = rule['.name'];
      return iface;
    });
}

// ---- interfaces ----

export interface WgInterfaceInput {
  name: string;
  privateKey: string;
  listenPort: string;
  /** Space-separated CIDRs: the router's addresses in the tunnel. */
  addresses: string;
  mtu: string;
  /** Put the interface in the LAN zone: peers reach the LAN and the internet. */
  joinLan: boolean;
  /** Allow the listen port from the WAN. */
  openPort: boolean;
}

export type WgInterfaceError = Partial<
  Record<
    keyof WgInterfaceInput,
    | 'name-invalid'
    | 'name-taken'
    | 'port-invalid'
    | 'port-taken'
    | 'address-invalid'
    | 'address-overlap'
    | 'mtu-invalid'
    | 'key-invalid'
  >
>;

const portOk = (p: string) => /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;

/** Next unused wgN, port and 10.N.0.1/24. */
export function suggestInterface(existing: WgConfigInterface[], network: Record<string, UciSection>) {
  let n = 0;
  while (network[`wg${n}`]) n++;
  const ports = new Set(existing.map((i) => i.listenPort));
  let port = 51820;
  while (ports.has(String(port))) port++;
  const taken = [
    ...takenSubnets(network).map((t) => `${t.ipaddr}/${t.prefix}`),
    ...existing.flatMap((i) => i.addresses),
  ];
  let x = 8;
  while (
    x < 255 &&
    taken.some((t) => prefixContains(t, `10.${x}.0.1`) || prefixContains(`10.${x}.0.0/24`, t.split('/')[0]))
  )
    x++;
  return { name: `wg${n}`, listenPort: String(port), addresses: `10.${x}.0.1/24` };
}

export function validateWgInterface(
  input: WgInterfaceInput,
  existing: WgConfigInterface[],
  network: Record<string, UciSection>,
  editing?: string,
): WgInterfaceError {
  const errors: WgInterfaceError = {};
  if (!/^[A-Za-z0-9_]{1,12}$/.test(input.name)) errors.name = 'name-invalid';
  else if (input.name !== editing && network[input.name]) errors.name = 'name-taken';
  if (!portOk(input.listenPort)) errors.listenPort = 'port-invalid';
  else if (existing.some((i) => i.name !== editing && i.listenPort === input.listenPort))
    errors.listenPort = 'port-taken';
  const addresses = words(input.addresses);
  const parsed = addresses.map((a) => (a.includes('/') ? parsePrefix(a) : null));
  if (!addresses.length || parsed.some((p) => !p)) errors.addresses = 'address-invalid';
  else {
    // LAN-style interfaces (ipaddr) and the other tunnels (addresses).
    const others = [
      ...takenSubnets(network).map((t) => `${t.ipaddr}/${t.prefix}`),
      ...existing.filter((i) => i.name !== editing).flatMap((i) => i.addresses),
    ];
    const overlaps = parsed.some((p) =>
      others.some(
        (o) => prefixContains(o, p!.address) || prefixContains(`${p!.network}/${p!.prefix}`, o.split('/')[0]),
      ),
    );
    if (overlaps) errors.addresses = 'address-overlap';
  }
  if (input.mtu && !(/^\d+$/.test(input.mtu) && Number(input.mtu) >= 1280 && Number(input.mtu) <= 1500))
    errors.mtu = 'mtu-invalid';
  if (!isWgKey(input.privateKey)) errors.privateKey = 'key-invalid';
  return errors;
}

const zoneNamed = (firewall: Record<string, UciSection>, name: string) =>
  ofType(firewall, 'zone').find((z) => z.name === name);

const portRule = (iface: string, port: string): UciValues => ({
  name: `${WG_RULE_PREFIX}${iface}`,
  src: 'wan',
  proto: 'udp',
  dest_port: port,
  target: 'ACCEPT',
});

export function createInterfaceChanges(input: WgInterfaceInput, firewall: Record<string, UciSection>): UbusCall[] {
  const values: UciValues = {
    proto: 'wireguard',
    private_key: input.privateKey,
    listen_port: input.listenPort,
    addresses: words(input.addresses),
  };
  if (input.mtu) values.mtu = input.mtu;
  const changes = [uci.add('network', 'interface', values, input.name)];
  const lan = zoneNamed(firewall, 'lan');
  if (input.joinLan && lan) {
    changes.push(uci.set('firewall', lan['.name'], { network: [...words(lan.network), input.name] }));
  }
  if (input.openPort) changes.push(uci.add('firewall', 'rule', portRule(input.name, input.listenPort)));
  return changes;
}

export function editInterfaceChanges(
  iface: WgConfigInterface,
  input: WgInterfaceInput,
  firewall: Record<string, UciSection> = {},
): UbusCall[] {
  const values: UciValues = {
    private_key: input.privateKey,
    listen_port: input.listenPort,
    addresses: words(input.addresses),
  };
  if (input.mtu) values.mtu = input.mtu;
  const changes = [uci.set('network', iface.name, values)];
  if (!input.mtu && iface.mtu) changes.push(uci.delOption('network', iface.name, 'mtu'));
  const lan = zoneNamed(firewall, 'lan');
  if (input.joinLan && !iface.zone && lan) {
    changes.push(uci.set('firewall', lan['.name'], { network: [...words(lan.network), iface.name] }));
  } else if (!input.joinLan && iface.zone === 'lan' && iface.zoneSection) {
    const zone = firewall[iface.zoneSection];
    changes.push(
      uci.set('firewall', iface.zoneSection, { network: words(zone?.network).filter((n) => n !== iface.name) }),
    );
  }
  if (iface.portRule && !input.openPort) changes.push(uci.del('firewall', iface.portRule));
  else if (iface.portRule && input.listenPort !== iface.listenPort) {
    changes.push(uci.set('firewall', iface.portRule, { dest_port: input.listenPort }));
  } else if (!iface.portRule && input.openPort) {
    changes.push(uci.add('firewall', 'rule', portRule(iface.name, input.listenPort)));
  }
  return changes;
}

export function deleteInterfaceChanges(iface: WgConfigInterface, firewall: Record<string, UciSection>): UbusCall[] {
  const changes = iface.peers.map((p) => uci.del('network', p.section));
  changes.push(uci.del('network', iface.name));
  if (iface.zoneSection) {
    const zone = firewall[iface.zoneSection];
    changes.push(
      uci.set('firewall', iface.zoneSection, { network: words(zone?.network).filter((n) => n !== iface.name) }),
    );
  }
  if (iface.portRule) changes.push(uci.del('firewall', iface.portRule));
  return changes;
}

// ---- peers ----

export interface WgPeerInput {
  name: string;
  publicKey: string;
  /** Empty when the user brought the peer's public key. */
  privateKey: string;
  presharedKey: string;
  /** Space-separated CIDRs. */
  allowedIps: string;
  endpointHost: string;
  endpointPort: string;
  keepalive: string;
  routeAllowedIps: boolean;
}

export type WgPeerError = Partial<
  Record<
    keyof WgPeerInput,
    'key-invalid' | 'address-invalid' | 'address-taken' | 'port-invalid' | 'keepalive-invalid' | 'name-too-long'
  >
>;

/** First IPv4 host in the tunnel that neither the router nor another peer uses, as a /32. */
export function nextPeerAddress(iface: WgConfigInterface): string | null {
  const net = iface.addresses.map((a) => parsePrefix(a)).find((p) => p?.family === 4);
  if (!net || net.prefix > 30) return null;
  const used = new Set([net.address, ...iface.peers.flatMap((p) => p.allowedIps.map((a) => a.split('/')[0]))]);
  const base = net.network.split('.').map(Number);
  const size = 2 ** (32 - net.prefix);
  for (let i = 1; i < size - 1; i++) {
    const n = (((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0) + i;
    const ip = [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
    if (!used.has(ip)) return `${ip}/32`;
  }
  return null;
}

export function validatePeer(input: WgPeerInput, iface: WgConfigInterface, editing?: string): WgPeerError {
  const errors: WgPeerError = {};
  if (input.name.length > 64) errors.name = 'name-too-long';
  if (!isWgKey(input.publicKey)) errors.publicKey = 'key-invalid';
  if (input.privateKey && !isWgKey(input.privateKey)) errors.privateKey = 'key-invalid';
  if (input.presharedKey && !isWgKey(input.presharedKey)) errors.presharedKey = 'key-invalid';
  const allowed = words(input.allowedIps);
  if (!allowed.length || allowed.some((a) => !parsePrefix(a.includes('/') ? a : `${a}/${isIPv6(a) ? 128 : 32}`))) {
    errors.allowedIps = 'address-invalid';
  } else {
    const others = iface.peers.filter((p) => p.section !== editing).flatMap((p) => p.allowedIps);
    if (allowed.some((a) => others.includes(a))) errors.allowedIps = 'address-taken';
  }
  if (input.endpointPort && !portOk(input.endpointPort)) errors.endpointPort = 'port-invalid';
  if (input.keepalive && !(/^\d+$/.test(input.keepalive) && Number(input.keepalive) <= 65535)) {
    errors.keepalive = 'keepalive-invalid';
  }
  return errors;
}

const PEER_OPTIONS: [keyof WgPeerInput, string][] = [
  ['privateKey', 'private_key'],
  ['presharedKey', 'preshared_key'],
  ['endpointHost', 'endpoint_host'],
  ['endpointPort', 'endpoint_port'],
  ['keepalive', 'persistent_keepalive'],
];

export function peerChanges(iface: WgConfigInterface, input: WgPeerInput, existing?: WgConfigPeer): UbusCall[] {
  const values: UciValues = { description: input.name.trim(), public_key: input.publicKey };
  for (const [key, option] of PEER_OPTIONS) {
    const v = String(input[key]).trim();
    if (v) values[option] = v;
  }
  // allowed_ips goes before the optional ones LuCI writes after it; uci keeps insertion order.
  const ordered: UciValues = {
    description: values.description,
    public_key: values.public_key,
    ...(values.private_key ? { private_key: values.private_key } : {}),
    ...(values.preshared_key ? { preshared_key: values.preshared_key } : {}),
    allowed_ips: words(input.allowedIps),
    ...Object.fromEntries(
      Object.entries(values).filter(([k]) => ['endpoint_host', 'endpoint_port', 'persistent_keepalive'].includes(k)),
    ),
  };
  if (input.routeAllowedIps) ordered.route_allowed_ips = '1';
  if (!existing) return [uci.add('network', `wireguard_${iface.name}`, ordered)];
  const changes = [uci.set('network', existing.section, ordered)];
  const had: Record<string, boolean> = {
    private_key: !!existing.privateKey,
    preshared_key: !!existing.presharedKey,
    endpoint_host: !!existing.endpointHost,
    endpoint_port: !!existing.endpointPort,
    persistent_keepalive: !!existing.keepalive,
    route_allowed_ips: existing.routeAllowedIps,
  };
  for (const option of Object.keys(had)) {
    if (had[option] && !(option in ordered)) changes.push(uci.delOption('network', existing.section, option));
  }
  return changes;
}

export const deletePeerChanges = (peer: WgConfigPeer): UbusCall[] => [uci.del('network', peer.section)];

// ---- export ----

export interface ClientConfigOptions {
  serverPublicKey: string;
  /** Host name or address the peer dials; the interface's listen port is appended. */
  endpoint: string;
  dns?: string[];
  /** What the peer sends through the tunnel: 0.0.0.0/0, ::/0 for everything, or the LAN only. */
  allowedIps: string[];
}

/** The peer's side as a wg-quick file (also what the QR code carries). */
export function clientConfig(iface: WgConfigInterface, peer: WgConfigPeer, o: ClientConfigOptions): string {
  if (!peer.privateKey) throw new ActionError('no-private-key');
  const hosts = peer.allowedIps.filter((a) => /\/(32|128)$/.test(a));
  const host = isIPv6(o.endpoint) ? `[${o.endpoint}]` : o.endpoint;
  const lines = [
    '[Interface]',
    `PrivateKey = ${peer.privateKey}`,
    `Address = ${(hosts.length ? hosts : peer.allowedIps.slice(0, 1)).join(', ')}`,
  ];
  if (o.dns?.length) lines.push(`DNS = ${o.dns.join(', ')}`);
  lines.push('', '[Peer]', `PublicKey = ${o.serverPublicKey}`);
  if (peer.presharedKey) lines.push(`PresharedKey = ${peer.presharedKey}`);
  lines.push(`Endpoint = ${host}:${iface.listenPort ?? '51820'}`, `AllowedIPs = ${o.allowedIps.join(', ')}`);
  if (peer.keepalive) lines.push(`PersistentKeepalive = ${peer.keepalive}`);
  return `${lines.join('\n')}\n`;
}

// ---- router calls ----

export async function generateKeyPair(conn: RouterConnection): Promise<{ privateKey: string; publicKey: string }> {
  const r = await conn.call<{ keys: { priv: string; pub: string } }>('luci.wireguard', 'generateKeyPair');
  return { privateKey: r.keys.priv, publicKey: r.keys.pub };
}

export async function generatePsk(conn: RouterConnection): Promise<string> {
  return (await conn.call<{ psk: string }>('luci.wireguard', 'generatePsk')).psk;
}

export async function publicKeyOf(conn: RouterConnection, privateKey: string): Promise<string> {
  const r = await conn.call<{ keys: { pub: string } }>('luci.wireguard', 'getPublicAndPrivateKeyFromPrivate', {
    privkey: privateKey,
  });
  return r.keys.pub;
}

export interface WgConfigState {
  interfaces: WgConfigInterface[];
  network: Record<string, UciSection>;
  firewall: Record<string, UciSection>;
  /** Public keys of running interfaces, from `wg show`. */
  publicKeys: Record<string, string>;
}

export async function getWgConfig(conn: RouterConnection): Promise<WgConfigState> {
  const [network, firewall, status] = await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'network' } },
    { object: 'uci', method: 'get', params: { config: 'firewall' } },
    { object: 'luci.wireguard', method: 'getWgInstances' },
  ]);
  if (!network.ok) throw network.error;
  const net = (network.data as { values?: Record<string, UciSection> }).values ?? {};
  const fw = firewall.ok ? ((firewall.data as { values?: Record<string, UciSection> }).values ?? {}) : {};
  const live = status.ok ? parseWgInstances(status.data) : [];
  return {
    interfaces: parseWgConfig(net, fw),
    network: net,
    firewall: fw,
    publicKeys: Object.fromEntries(live.filter((i) => i.publicKey).map((i) => [i.name, i.publicKey])),
  };
}

type Tuning = Omit<ApplyOptions, 'mode'>;

/** Tunnels can carry the phone's own connection (remote management): always with rollback. */
export const applyWgChanges = (conn: RouterConnection, changes: UbusCall[], t?: Tuning): Promise<ApplyOutcome> =>
  stageAndApply(conn, changes, { mode: 'rollback', ...t });
