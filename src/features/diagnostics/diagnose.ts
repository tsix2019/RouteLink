import type { RouterConnection } from '@/api/connection/types';
import type { GroupMember } from '@/api/group';
import { isConnectivityError } from '@/api/http/errors';
import { agentEvents } from '@/api/services/agent';
import { agentLatency, agentOutages, lossPct } from '@/api/services/agent-diag';
import type { Client } from '@/api/services/clients';
import { runTool } from '@/api/services/diag';
import { getInterfaces, pickWan } from '@/api/services/network';
import type { SecurityLevel } from '@/features/wifi-tools/security';

import {
  apUplink,
  dns,
  internet,
  phoneWifi,
  stability,
  upstream,
  wan,
  wifiSecurity,
  type SegmentId,
  type Verdict,
} from './rules';
import type { PingSummary } from './tools';

/**
 * Collects the facts of the one-click diagnosis (design §18.1) from near to far and reports each segment
 * as soon as it is judged. Network access is injected so the run can be tested against the demo router.
 */

export interface DiagnoseInput {
  gateway: RouterConnection;
  /** APs of the group; members without a connection (password unknown) are left out. */
  members: GroupMember[];
  /** Group-merged clients and the phone's own IPv4 (the AP hears its signal). */
  clients: Client[];
  phoneIp?: string;
  plugin: boolean;
  /** WF-4's worst level over the group's networks; undefined when unknown. */
  securityLevel?: SecurityLevel;
  /** A round trip from the phone to the router (ms), null when it failed. */
  pingRouter: () => Promise<number | null>;
  /** The phone's own HTTP 204 check through the router; undefined to skip. */
  http204?: () => Promise<boolean>;
  now?: () => number;
}

export type SegmentFacts = Record<string, string | number | boolean | null | undefined>;

export interface SegmentResult {
  segment: SegmentId;
  verdict: Verdict;
  facts: SegmentFacts;
}

/** Public resolvers people can reach from China and elsewhere. */
export const PUBLIC_TARGETS = ['223.5.5.5', '1.1.1.1'];
export const DNS_NAMES = ['www.baidu.com', 'www.apple.com'];

const lossOf = (p: PingSummary) => (p.transmitted ? p.lossPct : 100);

/**
 * A ping run on a router: its summary (no replies is 100 % loss), or why it never ran. `failed`: the
 * router refused the command (no `file exec` for it) or the call failed; `unreachable`: the phone could
 * not reach that router at all. Neither says anything about the path being pinged.
 */
type PingRun = { summary: PingSummary; error?: undefined } | { summary?: undefined; error: 'failed' | 'unreachable' };

async function pingFrom(conn: RouterConnection, host: string, count: number): Promise<PingRun> {
  try {
    const r = await runTool(conn, 'ping', host, { count });
    return r.tool === 'ping' ? { summary: r.summary } : { error: 'failed' };
  } catch (e) {
    return { error: isConnectivityError(e) ? 'unreachable' : 'failed' };
  }
}

export async function runDiagnosis(
  input: DiagnoseInput,
  onResult: (r: SegmentResult) => void,
): Promise<SegmentResult[]> {
  const now = input.now ?? Date.now;
  const results: SegmentResult[] = [];
  const report = (segment: SegmentId, verdict: Verdict, facts: SegmentFacts) => {
    const r = { segment, verdict, facts };
    results.push(r);
    onResult(r);
  };

  // 1. Phone to Wi-Fi: what the AP hears, and five HTTP round trips to the router.
  const me = input.phoneIp ? input.clients.find((c) => c.ipv4 === input.phoneIp) : undefined;
  const rtts: (number | null)[] = [];
  for (let i = 0; i < 5; i++) rtts.push(await input.pingRouter());
  const ok = rtts.filter((v): v is number => v !== null);
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : undefined;
  const jitter = ok.length > 1 ? ok.slice(1).reduce((s, v, i) => s + Math.abs(v - ok[i]), 0) / (ok.length - 1) : 0;
  const rttLoss = ((rtts.length - ok.length) / rtts.length) * 100;
  report(
    'phone-wifi',
    phoneWifi({ signal: me?.wifi?.signal, rtt: { avgMs: avg, jitterMs: jitter, lossPct: rttLoss } }),
    {
      signal: me?.wifi?.signal,
      band: me?.wifi?.band,
      rate: me?.wifi?.rxRate,
      ap: me?.ap?.name,
      rttMs: avg === undefined ? null : Math.round(avg),
      jitterMs: Math.round(jitter),
      lossPct: rttLoss,
    },
  );

  // 2. Each AP to the gateway.
  const ifaces = await getInterfaces(input.gateway).catch(() => []);
  const lanIp = ifaces.find((i) => i.name === 'lan')?.ipv4[0]?.address;
  const reachable = input.members.filter((m) => m.connection);
  const uplinks = await Promise.all(
    reachable.map(async (m) => {
      const p: PingRun = lanIp ? await pingFrom(m.connection!, lanIp, 5) : { error: 'failed' };
      // An AP the phone cannot reach at all is cut off: that is its link failing, not the ping.
      return { m, p, loss: p.summary ? lossOf(p.summary) : p.error === 'unreachable' ? 100 : null };
    }),
  );
  const apLoss = (u: (typeof uplinks)[number]) =>
    u.p.summary ? `${Math.round(lossOf(u.p.summary))}%` : u.p.error === 'unreachable' ? '✕' : '—';
  report('ap-uplink', apUplink(uplinks.map((u) => ({ lossPct: u.loss }))), {
    aps: uplinks.map((u) => `${u.m.name}: ${apLoss(u)}`).join(', ') || undefined,
    notRun: uplinks.some((u) => u.p.error === 'failed') ? 'ping' : undefined,
  });

  // 3. The gateway's WAN, with reconnects in the last day from the plugin.
  const w = pickWan(ifaces);
  const day = Math.floor(now() / 1000) - 86_400;
  const redials = input.plugin
    ? await agentEvents(input.gateway, { start: day, end: Math.floor(now() / 1000) + 1, types: ['wan_down'] })
        .then((e) => e.count)
        .catch(() => undefined)
    : undefined;
  report('wan', wan({ up: !!w?.up, hasIp: !!w?.ipv4.length, redials24h: redials }), {
    proto: w?.proto,
    ip: w?.ipv4[0]?.address,
    uptimeSec: w?.uptimeSec,
    redials,
  });

  // 4. The next hop upstream. A ping that could not run is unknown, not a dead line.
  const hop = w?.gateway ? await pingFrom(input.gateway, w.gateway, 5) : undefined;
  report('upstream', upstream({ lossPct: hop?.summary ? lossOf(hop.summary) : null }), {
    nexthop: w?.gateway,
    avgMs: hop?.summary?.avg,
    notRun: hop?.error ? 'ping' : undefined,
  });

  // 5 + 6. Public addresses and the phone's HTTP check (together they decide whether DNS advice makes
  // sense), then names. Only pings that ran count; one that sent nothing (no route) lost all four.
  const runs = await Promise.all(PUBLIC_TARGETS.map((ip) => pingFrom(input.gateway, ip, 4)));
  const pings = runs.flatMap((p) => (p.summary ? [p.summary] : []));
  const sent = pings.reduce((s, p) => s + (p.transmitted || 4), 0);
  const got = pings.reduce((s, p) => s + p.received, 0);
  const publicLoss = pings.length ? ((sent - got) / sent) * 100 : null;
  const lookups = await Promise.all(
    DNS_NAMES.map(async (name) => {
      try {
        const r = await runTool(input.gateway, 'nslookup', name);
        return { name, ran: true, ok: r.tool === 'nslookup' && r.summary.answers.length > 0, ms: r.ms };
      } catch {
        return { name, ran: false, ok: false, ms: 0 };
      }
    }),
  );
  const http = input.http204 ? await input.http204().catch(() => false) : undefined;
  const online = (publicLoss !== null && publicLoss < 100) || http === true;
  const resolved = lookups.filter((l) => l.ran);
  report('dns', dns(resolved, online), {
    ms: lookups.map((l) => `${l.name} ${!l.ran ? '—' : l.ok ? `${l.ms} ms` : '✕'}`).join(', '),
    notRun: resolved.length < lookups.length ? 'nslookup' : undefined,
  });
  report('internet', internet({ lossPct: publicLoss, http204: http }), {
    lossPct: publicLoss,
    avgMs: pings.find((p) => p.avg !== undefined)?.avg,
    http204: http,
    notRun: pings.length < runs.length ? 'ping' : undefined,
  });

  // 7. The last 24 hours from the plugin's probes.
  let recent: { lossPct: number | null; outages: number } | null = null;
  if (input.plugin) {
    const end = Math.floor(now() / 1000);
    const [lat, out] = await Promise.all([
      agentLatency(input.gateway, { start: end - 86_400, end, maxPoints: 24 }).catch(() => null),
      agentOutages(input.gateway, { start: end - 86_400, end }).catch(() => null),
    ]);
    if (lat && out) {
      const custom = lat.summary.filter((s) => lat.targets.find((t) => t.id === s.target)?.kind === 'custom');
      const totals = custom.reduce((acc, s) => ({ sent: acc.sent + s.sent, lost: acc.lost + s.lost }), {
        sent: 0,
        lost: 0,
      });
      recent = { lossPct: lossPct(totals), outages: out.count };
    }
  }
  report('stability', stability(recent), { lossPct: recent?.lossPct, outages: recent?.outages });

  // 8. Wi-Fi security.
  report('wifi-security', wifiSecurity(input.securityLevel), { level: input.securityLevel });
  return results;
}

/** Plain-text summary for sharing (design §18.1 "分享"). */
export function shareText(
  results: SegmentResult[],
  label: (segment: SegmentId) => string,
  status: (s: Verdict['status']) => string,
  advice: (a: Verdict['advice'][number]) => string,
): string {
  return results
    .map((r) => {
      const tips = r.verdict.advice.map((a) => `  · ${advice(a)}`).join('\n');
      return `${status(r.verdict.status)} ${label(r.segment)}${tips ? `\n${tips}` : ''}`;
    })
    .join('\n');
}
