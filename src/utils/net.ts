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

/** The eight 16-bit groups of an IPv6 address ("::" and a trailing dotted IPv4 part allowed; no zone index). */
export function ipv6ToWords(ip: string): number[] {
  const text = ip.trim().toLowerCase();
  const halves = text.split('::');
  if (!/^[0-9a-f:.]+$/.test(text) || halves.length > 2) throw new Error(`invalid IPv6 address: ${ip}`);
  const words = (part: string, last: boolean): number[] =>
    part === ''
      ? []
      : part.split(':').flatMap((group, i, all) => {
          if (group.includes('.')) {
            if (!last || i !== all.length - 1) throw new Error(`invalid IPv6 address: ${ip}`);
            const n = ipToInt(group);
            return [n >>> 16, n & 0xffff];
          }
          if (!/^[0-9a-f]{1,4}$/.test(group)) throw new Error(`invalid IPv6 address: ${ip}`);
          return [parseInt(group, 16)];
        });
  if (halves.length === 1) {
    const all = words(text, true);
    if (all.length !== 8) throw new Error(`invalid IPv6 address: ${ip}`);
    return all;
  }
  const head = words(halves[0], false);
  const tail = words(halves[1], true);
  // "::" stands for at least one group of zeros.
  if (head.length + tail.length > 7) throw new Error(`invalid IPv6 address: ${ip}`);
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

export function isIPv6(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    ipv6ToWords(value);
    return true;
  } catch {
    return false;
  }
}

/** RFC 5952 text: lower case, the first longest run of two or more zero groups shortened to "::". */
export function wordsToIpv6(words: number[]): string {
  let best = { at: -1, len: 1 };
  for (let i = 0; i < 8;) {
    if (words[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const hex = (ws: number[]) => ws.map((w) => w.toString(16)).join(':');
  if (best.at < 0) return hex(words);
  return `${hex(words.slice(0, best.at))}::${hex(words.slice(best.at + best.len))}`;
}

/** IPv4 as two 16-bit words, IPv6 as eight; null when the text is neither. */
function ipWords(ip: string): number[] | null {
  if (isIPv4(ip)) {
    const n = ipToInt(ip);
    return [n >>> 16, n & 0xffff];
  }
  return isIPv6(ip) ? ipv6ToWords(ip) : null;
}

const maskWords = (words: number[], prefix: number) =>
  words.map((w, i) => {
    const bits = Math.min(16, Math.max(0, prefix - i * 16));
    return bits === 0 ? 0 : w & ((0xffff << (16 - bits)) & 0xffff);
  });

const wordsToText = (words: number[]) =>
  words.length === 2 ? intToIp(((words[0] << 16) >>> 0) + words[1]) : wordsToIpv6(words);

export interface IpPrefix {
  family: 4 | 6;
  /** The address as written, normalised ("2001:DB8::5" → "2001:db8::5"). */
  address: string;
  prefix: number;
  /** The address with the host bits cleared. */
  network: string;
}

/** "a.b.c.d/n", "x::y/n", or a bare address (a host prefix: /32 or /128). Null when malformed. */
export function parsePrefix(text: string): IpPrefix | null {
  const [addr, len, ...rest] = text.trim().split('/');
  const words = rest.length ? null : ipWords(addr);
  if (!words) return null;
  const family = words.length === 2 ? 4 : 6;
  const max = family === 4 ? 32 : 128;
  if (len !== undefined && !/^\d{1,3}$/.test(len)) return null;
  const prefix = len === undefined ? max : Number(len);
  if (prefix > max) return null;
  return { family, address: wordsToText(words), prefix, network: wordsToText(maskWords(words, prefix)) };
}

/** Whether `ip` lies inside the prefix `cidr` (false across address families). */
export function prefixContains(cidr: string, ip: string): boolean {
  const net = parsePrefix(cidr);
  const words = ipWords(ip.trim());
  if (!net || !words || (words.length === 2 ? 4 : 6) !== net.family) return false;
  return wordsToText(maskWords(words, net.prefix)) === net.network;
}
