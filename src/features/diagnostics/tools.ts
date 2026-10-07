/**
 * Diagnostic tools (design §18.2, DG-2): ping, traceroute and nslookup run on the router through the
 * `file exec` permission LuCI's diagnostics page already has, so no plugin is needed. Pure: the command
 * line for a request, and summaries parsed from busybox output.
 */

export type Tool = 'ping' | 'traceroute' | 'nslookup';

export interface ToolOptions {
  /** ping: echo requests to send (1–20). */
  count?: number;
  ipv6?: boolean;
  /** nslookup: the DNS server to ask instead of the router's resolver. */
  server?: string;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+(%[\w.-]+)?$/;
const HOST =
  /^(?=.{1,253}$)([a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)(\.[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*\.?$/;

export const isIpv4 = (s: string) => IPV4.test(s);
export const isIpv6 = (s: string) => s.includes(':') && IPV6.test(s);

/** A host name or an address; nothing that could be read as an option. */
export function isValidTarget(s: string): boolean {
  const v = s.trim();
  if (!v || v.startsWith('-')) return false;
  return isIpv4(v) || isIpv6(v) || HOST.test(v);
}

export const PING_COUNTS = [4, 10, 20] as const;

/** The commands LuCI's diagnostics ACL allows (busybox links on 23.05–25.12). */
export function toolCommand(tool: Tool, target: string, o: ToolOptions = {}): { command: string; params: string[] } {
  const host = target.trim();
  const v6 = o.ipv6 || isIpv6(host);
  switch (tool) {
    case 'ping': {
      const count = Math.min(20, Math.max(1, Math.round(o.count ?? 4)));
      // -W: wait at most 2 s for each reply, -w: give up after the whole run could have taken.
      return {
        command: v6 ? '/bin/ping6' : '/bin/ping',
        params: ['-c', String(count), '-W', '2', '-w', String(count * 2 + 3), host],
      };
    }
    case 'traceroute':
      // One probe per hop, 1 s each, 20 hops: done well within the 60-second limit; -n skips slow reverse lookups.
      return {
        command: v6 ? '/bin/traceroute6' : '/bin/traceroute',
        params: ['-n', '-w', '1', '-q', '1', '-m', '20', host],
      };
    case 'nslookup':
      return { command: '/usr/bin/nslookup', params: o.server ? [host, o.server] : [host] };
  }
}

export interface PingSummary {
  transmitted: number;
  received: number;
  /** 0–100 */
  lossPct: number;
  /** ms */
  min?: number;
  avg?: number;
  max?: number;
  /** Mean absolute difference between consecutive replies (ms). */
  jitter?: number;
  replies: { seq: number; ttl?: number; ms: number }[];
  /** "Network unreachable", "bad address" and the like. */
  error?: string;
}

export function parsePing(output: string): PingSummary {
  const replies = [...output.matchAll(/seq=(\d+)(?: ttl=(\d+))? time=([\d.]+) ms/g)].map((m) => ({
    seq: Number(m[1]),
    ttl: m[2] ? Number(m[2]) : undefined,
    ms: Number(m[3]),
  }));
  const stats =
    /(\d+) packets transmitted, (\d+) (?:packets )?received(?:, (?:\+\d+ duplicates, )?(\d+)% packet loss)?/.exec(
      output,
    );
  const rtt = /min\/avg\/max = ([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(output);
  const transmitted = stats ? Number(stats[1]) : replies.length;
  const received = stats ? Number(stats[2]) : replies.length;
  const lossPct =
    stats?.[3] !== undefined ? Number(stats[3]) : transmitted ? ((transmitted - received) / transmitted) * 100 : 100;
  const times = replies.map((r) => r.ms);
  const jitter =
    times.length > 1
      ? times.slice(1).reduce((s, v, i) => s + Math.abs(v - times[i]), 0) / (times.length - 1)
      : undefined;
  const error = /ping6?: (.+)/.exec(output)?.[1]?.trim();
  return {
    transmitted,
    received,
    lossPct,
    min: rtt ? Number(rtt[1]) : times.length ? Math.min(...times) : undefined,
    avg: rtt ? Number(rtt[2]) : times.length ? times.reduce((a, b) => a + b, 0) / times.length : undefined,
    max: rtt ? Number(rtt[3]) : times.length ? Math.max(...times) : undefined,
    jitter,
    replies,
    error: transmitted === 0 || !stats ? error : undefined,
  };
}

export interface Hop {
  hop: number;
  /** Reverse name, when traceroute resolved it. */
  host?: string;
  ip?: string;
  /** ms per answered probe */
  times: number[];
}

/** busybox traceroute/traceroute6, with or without -n; "*" probes get no time. */
export function parseTraceroute(output: string): Hop[] {
  const hops: Hop[] = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[2];
    const named = /^(\S+) \(([^)]+)\)/.exec(rest);
    const bare = /^([0-9a-fA-F.:]+)\s/.exec(`${rest} `);
    const ip = named ? named[2] : bare && !rest.startsWith('*') ? bare[1] : undefined;
    const host = named && named[1] !== named[2] ? named[1] : undefined;
    const times = [...rest.matchAll(/([\d.]+) ms/g)].map((t) => Number(t[1]));
    hops.push({ hop: Number(m[1]), host, ip, times });
  }
  return hops;
}

export interface NslookupResult {
  server?: string;
  answers: { name: string; address?: string; cname?: string }[];
  /** NXDOMAIN, SERVFAIL, timeout… */
  error?: string;
}

export function parseNslookup(output: string): NslookupResult {
  const server = /^Server:\s+(\S+)/m.exec(output)?.[1];
  const answers: NslookupResult['answers'] = [];
  let name: string | undefined;
  // Skip the "Server:/Address:" block of the resolver itself.
  const body = output.replace(/^Server:[^\n]*\nAddress:[^\n]*\n/m, '');
  for (const line of body.split('\n')) {
    const cname = /^(\S+)\s+canonical name = (\S+?)\.?$/.exec(line);
    if (cname) {
      answers.push({ name: cname[1], cname: cname[2] });
      continue;
    }
    const n = /^Name:\s+(\S+)/.exec(line);
    if (n) {
      name = n[1];
      continue;
    }
    const a = /^Address(?:\s+\d+)?:\s+(\S+)/.exec(line);
    if (a && name) answers.push({ name, address: a[1] });
  }
  const fail =
    /\*\* server can't find [^:]+: (\w+)/.exec(output)?.[1] ??
    (/connection timed out|no servers could be reached/.test(output) ? 'TIMEOUT' : undefined);
  return { server, answers, error: answers.length ? undefined : (fail ?? (output.trim() ? 'NO_ANSWER' : undefined)) };
}
