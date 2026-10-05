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

/** `luci.wireguard getWgInstances`: the demo's road-warrior tunnel with one phone on it right now. */
export function demoWireGuard(s: DemoState, now: number) {
  const t = Math.floor(now / 1000);
  const wg = s.counters.wg0 ?? { rx: 0, tx: 0 };
  return {
    wg0: {
      name: 'wg0',
      public_key: 'nWhlfN3/0rR2NrHCVQ5Cty1AcDBV5XJ5j5Nf0Aaz9Wc=',
      listen_port: '51820',
      fwmark: 'off',
      peers: [
        {
          name: 'iPhone (mobile data)',
          public_key: 'GmV9qO7lc8XUb5Jbb2a1Q0a4H7mtw2C4mJx8Wn6K8Ug=',
          endpoint: '198.51.100.7:40211',
          allowed_ips: ['10.8.0.2/32'],
          latest_handshake: String(t - 37 - (t % 120)),
          transfer_rx: String(Math.round(wg.rx * 0.8)),
          transfer_tx: String(Math.round(wg.tx * 0.8)),
          persistent_keepalive: '25',
        },
        {
          name: 'Office laptop',
          public_key: 'x2Cq1v7d0Jc3bR1yQ6VQXr7w4k0D8Jx1m3T2tq4o2Ws=',
          endpoint: '203.0.113.200:51820',
          allowed_ips: ['10.8.0.3/32', '10.10.0.0/16'],
          latest_handshake: String(t - 2 * 86_400 - 3_600),
          transfer_rx: String(Math.round(wg.rx * 0.2)),
          transfer_tx: String(Math.round(wg.tx * 0.2)),
          persistent_keepalive: 'off',
        },
      ],
    },
  };
}
