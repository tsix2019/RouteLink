import { hash01 } from './random';
import type { DemoState } from './state';

/** Tracked connections of the demo router (`luci getConntrackList`) and reverse DNS for them. */

interface Destination {
  ip: string;
  name?: string;
  proto: 'tcp' | 'udp';
  port: number;
}

const DESTINATIONS: Destination[] = [
  { ip: '142.250.66.110', name: 'hkg12s28-in-f14.1e100.net', proto: 'udp', port: 443 },
  { ip: '17.253.144.10', name: 'usscz2-vip-bx-008.aaplimg.com', proto: 'tcp', port: 443 },
  { ip: '45.57.90.1', name: 'ipv4-c047-hkg001-ix.1.oca.nflxvideo.net', proto: 'tcp', port: 443 },
  { ip: '20.190.151.7', proto: 'tcp', port: 443 },
  { ip: '104.18.32.47', proto: 'tcp', port: 443 },
  { ip: '183.2.172.42', proto: 'tcp', port: 443 },
  { ip: '52.94.236.248', name: 'dynamodb.us-east-1.amazonaws.com', proto: 'tcp', port: 443 },
  { ip: '157.240.22.35', name: 'edge-star-mini-shv-01-hkg4.facebook.com', proto: 'udp', port: 443 },
];

/** The router's own name lookups and clock (from its WAN address). */
const ROUTER: Destination[] = [
  { ip: '223.5.5.5', name: 'public1.alidns.com', proto: 'udp', port: 53 },
  { ip: '119.29.29.29', proto: 'udp', port: 53 },
  { ip: '162.159.200.123', name: 'time.cloudflare.com', proto: 'udp', port: 123 },
];

/** Someone on the internet reaching the NAS through the port forward (wan 8443 → NAS:443). */
const INBOUND = { ip: '198.51.100.23', name: 'customer.example.net' };

const WAN_IP = '203.0.113.45';

export function demoConntrack(s: DemoState, now: number) {
  const t = Math.floor(now / 1000);
  const result: Record<string, unknown>[] = [];
  const add = (src: string, sport: number, d: Destination, rate: number, age: number, key: number) =>
    result.push({
      bytes: Math.round(rate * (age + (t % 600))),
      packets: Math.max(1, Math.round((rate * (age + (t % 600))) / 900)),
      layer3: 'ipv4',
      layer4: d.proto,
      src,
      sport,
      dst: d.ip,
      dport: d.port,
      timeout: d.proto === 'tcp' ? 7_440 - (key % 400) : 180 - (key % 60),
    });

  s.devices.forEach((d, i) => {
    if (!d.online || (d.bannedUntil && d.bannedUntil > now)) return;
    const count = 2 + Math.floor(hash01(i, 1) * 4);
    for (let k = 0; k < count; k++) {
      const dest =
        d.hostname === 'Living-Room-TV' && k === 0
          ? DESTINATIONS[2]
          : DESTINATIONS[Math.floor(hash01(i, k, 2) * DESTINATIONS.length)];
      const rate = dest === DESTINATIONS[2] ? 600_000 : 150 + hash01(i, k, 4) * 12_000;
      add(
        d.ip,
        40_000 + Math.floor(hash01(i, k, 5) * 20_000),
        dest,
        rate,
        30 + Math.floor(hash01(i, k, 3) * 600),
        i * 7 + k,
      );
    }
  });
  ROUTER.forEach((d, k) => add(WAN_IP, 30_000 + k * 17, d, 40, 20, k));
  const nas = s.devices.find((d) => d.hostname === 'NAS');
  if (nas?.online) {
    result.push({
      bytes: 2_400_000 + (t % 600) * 3_000,
      packets: 2_100 + (t % 600) * 3,
      layer3: 'ipv4',
      layer4: 'tcp',
      src: INBOUND.ip,
      sport: 61_022,
      dst: WAN_IP,
      dport: 8443,
      timeout: 7_300,
    });
  }
  return { result };
}

const NAMES: Record<string, string> = Object.fromEntries(
  [...DESTINATIONS, ...ROUTER, INBOUND].filter((d) => d.name).map((d) => [d.ip, d.name!]),
);

/** Answers like `network.rrdns lookup`: only the addresses that have a name. */
export function demoReverseDns(s: DemoState, addrs: unknown) {
  const out: Record<string, string> = {};
  for (const a of Array.isArray(addrs) ? addrs : []) {
    const device = s.devices.find((d) => d.ip === a);
    const name = device ? `${device.hostname}.lan` : NAMES[String(a)];
    if (name) out[String(a)] = name;
  }
  return out;
}
