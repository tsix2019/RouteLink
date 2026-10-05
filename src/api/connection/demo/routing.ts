import { bytesToBase64 } from '@/utils/base64';

import { hash01 } from './random';
import type { DemoState } from './state';

/** Routing tables of the demo router, as `ip -4|-6 route show table all` prints them. */

const DEVICES: Record<string, string> = { lan: 'br-lan', wan: 'pppoe-wan', wan6: 'pppoe-wan', wg0: 'wg0' };

const IPV4_MAIN = [
  'default via 203.0.113.1 dev pppoe-wan proto static',
  '10.8.0.0/24 dev wg0 proto kernel scope link src 10.8.0.1',
  '192.168.8.0/24 dev br-lan proto kernel scope link src 192.168.8.1',
  '203.0.113.1 dev pppoe-wan proto kernel scope link src 203.0.113.45',
];
const IPV4_LOCAL = [
  'local 10.8.0.1 dev wg0 table local proto kernel scope host src 10.8.0.1',
  'broadcast 10.8.0.255 dev wg0 table local proto kernel scope link src 10.8.0.1',
  'local 127.0.0.0/8 dev lo table local proto kernel scope host src 127.0.0.1',
  'local 127.0.0.1 dev lo table local proto kernel scope host src 127.0.0.1',
  'broadcast 127.255.255.255 dev lo table local proto kernel scope link src 127.0.0.1',
  'local 192.168.8.1 dev br-lan table local proto kernel scope host src 192.168.8.1',
  'broadcast 192.168.8.255 dev br-lan table local proto kernel scope link src 192.168.8.1',
  'local 203.0.113.45 dev pppoe-wan table local proto kernel scope host src 203.0.113.45',
];
const IPV6_MAIN = [
  'default from 2001:db8:45::/64 via fe80::1 dev pppoe-wan proto static metric 512 pref medium',
  '2001:db8:45::/64 dev pppoe-wan proto kernel metric 256 pref medium',
  'fd00:8::/64 dev br-lan proto static metric 1024 pref medium',
  'unreachable fd00:8::/48 dev lo proto static metric 2147483647 pref medium',
  'fe80::/64 dev br-lan proto kernel metric 256 pref medium',
  'fe80::/10 dev pppoe-wan proto kernel metric 256 pref medium',
];
const IPV6_LOCAL = [
  'local ::1 dev lo table local proto kernel metric 0 pref medium',
  'local 2001:db8:45::1 dev pppoe-wan table local proto kernel metric 0 pref medium',
  'local fd00:8::1 dev br-lan table local proto kernel metric 0 pref medium',
  'multicast ff00::/8 dev br-lan table local proto kernel metric 256 pref medium',
];

/** Static routes from uci network, installed like netifd does (proto static, own table if set). */
function staticLines(s: DemoState, family: 4 | 6): string[] {
  const type = family === 4 ? 'route' : 'route6';
  return Object.values(s.uci.network ?? {})
    .filter((x) => x['.type'] === type && x.disabled !== '1' && typeof x.target === 'string')
    .map((x) => {
      const dev = DEVICES[String(x.interface)] ?? String(x.interface);
      const parts = [String(x.target)];
      if (x.gateway) parts.push(`via ${x.gateway}`);
      parts.push(`dev ${dev}`);
      if (x.table && x.table !== 'main') parts.push(`table ${x.table}`);
      parts.push('proto static');
      if (x.metric) parts.push(`metric ${x.metric}`);
      return parts.join(' ');
    });
}

export function demoIpRoute(s: DemoState, family: 4 | 6): string {
  const lines =
    family === 4
      ? [...IPV4_MAIN, ...staticLines(s, 4), ...IPV4_LOCAL]
      : [...IPV6_MAIN, ...staticLines(s, 6), ...IPV6_LOCAL];
  return `${lines.join(' \n')} \n`;
}

/** Live state of the two seeded peers; peers added in the demo have not connected yet. */
const SEEDED_PEERS: Record<string, { endpoint: string; ago: (t: number) => number; share: number }> = {
  'GmV9qO7lc8XUb5Jbb2a1Q0a4H7mtw2C4mJx8Wn6K8Ug=': {
    endpoint: '198.51.100.7:40211',
    ago: (t) => 37 + (t % 120),
    share: 0.8,
  },
  'x2Cq1v7d0Jc3bR1yQ6VQXr7w4k0D8Jx1m3T2tq4o2Ws=': {
    endpoint: '203.0.113.200:51820',
    ago: () => 2 * 86_400 + 3_600,
    share: 0.2,
  },
};

/** A key-shaped value derived from `text` (the demo cannot do Curve25519). */
export function demoKey(text: string): string {
  const seed = Array.from(text, (c) => c.charCodeAt(0));
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => Math.floor(hash01(i, ...seed) * 256));
  return bytesToBase64(bytes);
}
export const demoPublicKey = (privateKey: string) => demoKey(`pub:${privateKey}`);

/** `luci.wireguard getWgInstances`, from the WireGuard interfaces and peers in the demo's uci network. */
export function demoWireGuard(s: DemoState, now: number) {
  const t = Math.floor(now / 1000);
  const wg = s.counters.wg0 ?? { rx: 0, tx: 0 };
  const network = Object.values(s.uci.network ?? {});
  const out: Record<string, unknown> = {};
  for (const iface of network.filter((x) => x['.type'] === 'interface' && x.proto === 'wireguard')) {
    const name = iface['.name'];
    out[name] = {
      name,
      public_key: typeof iface.private_key === 'string' ? demoPublicKey(iface.private_key) : '(none)',
      listen_port: String(iface.listen_port ?? '0'),
      fwmark: 'off',
      peers: network
        .filter((p) => p['.type'] === `wireguard_${name}`)
        .map((p) => {
          const key = String(p.public_key ?? '');
          const seeded = name === 'wg0' ? SEEDED_PEERS[key] : undefined;
          return {
            name: p.description,
            public_key: key,
            endpoint: seeded?.endpoint ?? '(none)',
            allowed_ips: seeded ? [p.allowed_ips].flat() : [],
            latest_handshake: seeded ? String(t - seeded.ago(t)) : '0',
            transfer_rx: String(seeded ? Math.round(wg.rx * seeded.share) : 0),
            transfer_tx: String(seeded ? Math.round(wg.tx * seeded.share) : 0),
            persistent_keepalive: p.persistent_keepalive ? String(p.persistent_keepalive) : 'off',
          };
        }),
    };
  }
  return out;
}
