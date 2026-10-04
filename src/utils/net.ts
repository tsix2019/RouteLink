const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipToInt(ip: string): number {
  const m = IPV4.exec(ip.trim());
  const parts = m ? m.slice(1).map(Number) : [];
  if (parts.length !== 4 || parts.some((n) => n > 255)) throw new Error(`invalid IPv4 address: ${ip}`);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export const intToIp = (n: number): string => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

export function isIPv4(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    ipToInt(value);
    return true;
  } catch {
    return false;
  }
}

export function netmaskToPrefix(mask: string): number {
  const n = ipToInt(mask);
  if (n === 0) return 0;
  const prefix = 32 - Math.log2((~n >>> 0) + 1);
  if (!Number.isInteger(prefix)) throw new Error(`non-contiguous netmask: ${mask}`);
  return prefix;
}

export function parseCidr(cidr: string): { network: number; prefix: number } {
  const [ip, p, ...rest] = cidr.trim().split('/');
  const prefix = Number(p);
  if (rest.length || p === undefined || !isIPv4(ip) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid CIDR: ${cidr}`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ipToInt(ip) & mask) >>> 0, prefix };
}

/** Usable host addresses of a CIDR; network/broadcast are excluded for prefixes up to /30. */
export function cidrHosts(cidr: string, maxHosts = 1024): string[] {
  const { network, prefix } = parseCidr(cidr);
  const size = 2 ** (32 - prefix);
  if (prefix >= 31) return Array.from({ length: size }, (_, i) => intToIp(network + i));
  if (size - 2 > maxHosts) throw new Error(`range too large: ${cidr}`);
  return Array.from({ length: size - 2 }, (_, i) => intToIp(network + 1 + i));
}

/**
 * Addresses to probe during auto-discovery (design §6): the whole subnet when it is /24 or
 * smaller, otherwise only the /24s holding the phone and the gateway. Gateway first, phone excluded.
 */
export function scanTargets(info: { ip: string; netmask: string; gateway?: string | null }): string[] {
  const prefix = netmaskToPrefix(info.netmask);
  const ranges =
    prefix >= 24
      ? [`${info.ip}/${prefix}`]
      : [...new Set([info.ip, info.gateway].filter(isIPv4).map((a) => `${a}/24`))];
  const hosts = new Set<string>();
  if (isIPv4(info.gateway)) hosts.add(info.gateway);
  for (const range of ranges) {
    for (const host of cidrHosts(range)) if (host !== info.ip) hosts.add(host);
  }
  return [...hosts];
}
