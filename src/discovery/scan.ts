export interface ProbeHit {
  scheme: 'http' | 'https';
  /** LuCI page title, e.g. "OpenWrt - LuCI" → hostname "OpenWrt". */
  hostname?: string;
}

export interface Prober {
  probe(host: string, signal: AbortSignal): Promise<ProbeHit | null>;
}

export interface DiscoveredRouter {
  /** IP address, or a host name such as openwrt.lan when it did not match an IP result. */
  address: string;
  scheme: 'http' | 'https';
  hostname?: string;
  isGateway: boolean;
  /** Host names that resolved to the same router (merged by LuCI hostname). */
  aliases: string[];
}

export interface ScanOptions {
  targets: string[];
  /** Names tried in addition to the IP targets (e.g. "openwrt.lan"). */
  hostnames?: string[];
  gateway?: string | null;
  prober: Prober;
  concurrency?: number;
  signal: AbortSignal;
  onFound?(router: DiscoveredRouter): void;
  onProgress?(done: number, total: number): void;
}

export const DEFAULT_HOSTNAMES = ['openwrt.lan', 'openwrt'];

/** Probes targets with bounded concurrency; gateway and host names first. Never sends credentials. */
export async function scan(o: ScanOptions): Promise<DiscoveredRouter[]> {
  const hostnames = o.hostnames ?? DEFAULT_HOSTNAMES;
  const ordered = [...new Set([...(o.gateway ? [o.gateway] : []), ...hostnames, ...o.targets])];
  const total = ordered.length;
  const found = new Map<string, DiscoveredRouter>();
  let next = 0;
  let done = 0;

  const report = (r: DiscoveredRouter) => {
    if (!o.signal.aborted) o.onFound?.(r);
  };

  const merge = (address: string, hit: ProbeHit) => {
    const isName = hostnames.includes(address);
    const twin = hit.hostname
      ? [...found.values()].find((r) => r.hostname === hit.hostname && hostnames.includes(r.address) !== isName)
      : undefined;
    if (twin && isName) {
      twin.aliases.push(address); // a name for an IP we already know
      report(twin);
      return;
    }
    if (twin && !isName) {
      // an IP for a name we already know: the IP entry replaces the name entry
      found.delete(twin.address);
      const router = {
        address,
        scheme: hit.scheme,
        hostname: hit.hostname,
        isGateway: address === o.gateway,
        aliases: [twin.address, ...twin.aliases],
      };
      found.set(address, router);
      report(router);
      return;
    }
    const router = {
      address,
      scheme: hit.scheme,
      hostname: hit.hostname,
      isGateway: address === o.gateway,
      aliases: [],
    };
    found.set(address, router);
    report(router);
  };

  const worker = async () => {
    while (!o.signal.aborted) {
      const i = next++;
      if (i >= total) return;
      const address = ordered[i];
      try {
        const hit = await o.prober.probe(address, o.signal);
        if (hit && !o.signal.aborted) merge(address, hit);
      } catch {
        // unreachable or not OpenWrt
      }
      done += 1;
      if (!o.signal.aborted) o.onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 48, total) }, worker));
  return sortRouters([...found.values()]);
}

/** Gateway first, then IPs in numeric order, then host names. */
export function sortRouters(routers: DiscoveredRouter[]): DiscoveredRouter[] {
  const ipKey = (a: string) => {
    const parts = a.split('.').map(Number);
    return parts.length === 4 && parts.every((n) => Number.isInteger(n))
      ? parts.reduce((acc, n) => acc * 256 + n, 0)
      : Infinity;
  };
  return [...routers].sort(
    (a, b) =>
      Number(b.isGateway) - Number(a.isGateway) ||
      ipKey(a.address) - ipKey(b.address) ||
      a.address.localeCompare(b.address),
  );
}
