import type { RouterConnection } from '../connection/types';

/** One tracked connection, in the direction it was opened. */
export interface Connection {
  family: 4 | 6;
  /** tcp, udp, icmp, … */
  protocol: string;
  src: string;
  sport?: number;
  dst: string;
  dport?: number;
  /** Both directions; 0 when conntrack accounting is off. */
  bytes: number;
  packets: number;
  /** Seconds until the entry expires. */
  timeout: number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1']);

const port = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** `luci getConntrackList` (LuCI's connections page). */
export function parseConntrack(raw: unknown): Connection[] {
  const list = (raw as { result?: unknown } | null)?.result;
  if (!Array.isArray(list)) return [];
  const out: Connection[] = [];
  for (const item of list) {
    const c = item as Record<string, unknown> | null;
    if (!c || typeof c.src !== 'string' || typeof c.dst !== 'string') continue;
    if (LOOPBACK.has(c.src) && LOOPBACK.has(c.dst)) continue;
    out.push({
      family: c.layer3 === 'ipv6' ? 6 : 4,
      protocol: String(c.layer4 ?? 'unknown').toLowerCase(),
      src: c.src,
      sport: port(c.sport),
      dst: c.dst,
      dport: port(c.dport),
      bytes: count(c.bytes),
      packets: count(c.packets),
      timeout: count(c.timeout),
    });
  }
  return out;
}

export async function getConnections(conn: RouterConnection): Promise<Connection[]> {
  return parseConntrack(await conn.call('luci', 'getConntrackList'));
}

export interface SourceGroup {
  /** The address that opened the connections: a device on the LAN, or the router itself. */
  address: string;
  bytes: number;
  connections: Connection[];
}

/** One group per source address; groups and their connections busiest first. */
export function groupBySource(list: Connection[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const c of list) {
    const g = groups.get(c.src) ?? { address: c.src, bytes: 0, connections: [] };
    g.bytes += c.bytes;
    g.connections.push(c);
    groups.set(c.src, g);
  }
  const sorted = [...groups.values()];
  for (const g of sorted) g.connections.sort((a, b) => b.bytes - a.bytes);
  return sorted.sort((a, b) => b.bytes - a.bytes || b.connections.length - a.connections.length);
}

const CACHE_MS = 10 * 60_000;

/**
 * Reverse DNS through the router (`network.rrdns lookup`, what LuCI uses), so names come from the
 * router's resolver and the phone sends no lookups of its own. Answers — including "no name" — are
 * kept for ten minutes.
 */
export class ReverseDns {
  private readonly cache = new Map<string, { name: string | null; at: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly batchSize = 100,
  ) {}

  async resolve(conn: RouterConnection, addresses: string[]): Promise<Record<string, string>> {
    const t = this.now();
    const missing = [...new Set(addresses)].filter((a) => {
      const hit = this.cache.get(a);
      return !hit || t - hit.at > CACHE_MS;
    });
    for (let i = 0; i < missing.length; i += this.batchSize) {
      const batch = missing.slice(i, i + this.batchSize);
      let names: Record<string, unknown> = {};
      try {
        names = await conn.call<Record<string, unknown>>('network.rrdns', 'lookup', {
          addrs: batch,
          timeout: 3_000,
          limit: batch.length,
        });
      } catch {
        // No resolver or no permission: addresses stay as they are.
        return this.known(addresses);
      }
      for (const a of batch) {
        const name = names?.[a];
        this.cache.set(a, { name: typeof name === 'string' && name ? name : null, at: t });
      }
    }
    return this.known(addresses);
  }

  private known(addresses: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of addresses) {
      const name = this.cache.get(a)?.name;
      if (name) out[a] = name;
    }
    return out;
  }
}
