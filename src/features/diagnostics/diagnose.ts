import type { RouterConnection } from '@/api/connection/types';
import type { GroupMember } from '@/api/group';
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

async function pingFrom(conn: RouterConnection, host: string, count: number): Promise<PingSummary | null> {
  try {
    const r = await runTool(conn, 'ping', host, { count });
    return r.tool === 'ping' ? r.summary : null;
  } catch {
    return null;
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
    reachable.map(async (m) => ({ m, p: lanIp ? await pingFrom(m.connection!, lanIp, 5) : null })),
  );
  report('ap-uplink', apUplink(uplinks.map((u) => ({ lossPct: u.p ? lossOf(u.p) : null }))), {
    aps: uplinks.map((u) => `${u.m.name}: ${u.p ? `${Math.round(lossOf(u.p))}%` : '—'}`).join(', ') || undefined,
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

  // 4. The next hop upstream.
  const hop = w?.gateway ? await pingFrom(input.gateway, w.gateway, 5) : null;
  report('upstream', upstream({ lossPct: hop ? lossOf(hop) : w?.gateway ? 100 : null }), {
    nexthop: w?.gateway,
    avgMs: hop?.avg,
  });

  // 5 + 6. Public addresses (also decides whether DNS advice makes sense), then names.
  const pings = await Promise.all(PUBLIC_TARGETS.map((ip) => pingFrom(input.gateway, ip, 4)));
  const sent = pings.reduce((s, p) => s + (p?.transmitted ?? 4), 0);
  const got = pings.reduce((s, p) => s + (p?.received ?? 0), 0);
  const publicLoss = sent ? ((sent - got) / sent) * 100 : null;
  const lookups = await Promise.all(
    DNS_NAMES.map(async (name) => {
      try {
        const r = await runTool(input.gateway, 'nslookup', name);
        return { name, ok: r.tool === 'nslookup' && r.summary.answers.length > 0, ms: r.ms };
      } catch {
        return { name, ok: false, ms: 0 };
      }
    }),
  );
  report('dns', dns(lookups, publicLoss !== null && publicLoss < 100), {
    ms: lookups.map((l) => `${l.name} ${l.ok ? `${l.ms} ms` : '✕'}`).join(', '),
  });
  const http = input.http204 ? await input.http204().catch(() => false) : undefined;
  report('internet', internet({ lossPct: publicLoss, http204: http }), {
    lossPct: publicLoss,
    avgMs: pings.find((p) => p?.avg !== undefined)?.avg,
    http204: http,
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
