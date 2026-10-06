import { UbusError } from '../../ubus/errors';
import { DAY, HOUR, MINUTE, localHour, type Ctx } from './presence';
import { hash01 } from './random';
import type { DemoState } from './state';

/**
 * Diagnostics of the demo network (P3): the plugin's latency probes and outage log, its router-side speed
 * test, and what ping / traceroute / nslookup print on the gateway and the AP. Deterministic like the rest
 * of the demo: an outage now and then (one a few hours ago), a busier evening, a 500 Mbit/s line.
 */

export const LATENCY_RETENTION = { latency_minute_days: 7, latency_hour_days: 90, outage_days: 365 };

/** The WAN's next hop (network.interface dump) and the default custom targets. */
const TARGETS = [
  { id: 0, ip: '203.0.113.1', kind: 'gateway', base: 2.1 },
  { id: 1, ip: '223.5.5.5', kind: 'custom', base: 6.4 },
  { id: 2, ip: '119.29.29.29', kind: 'custom', base: 8.3 },
  { id: 3, ip: '1.1.1.1', kind: 'custom', base: 47.5 },
] as const;

type Cause = 'wan_down' | 'redial' | 'upstream';
interface DemoOutage {
  start: number;
  end: number;
  cause: Cause;
}

const CAUSES: Cause[] = ['redial', 'upstream', 'wan_down'];

/** Outages overlapping [from, to): about one every five days, plus a short redial some hours ago. */
export function outagesBetween(ctx: Ctx, from: number, to: number): DemoOutage[] {
  const out: DemoOutage[] = [];
  const since = ctx.state.agent.dataSince;
  for (let day = Math.floor(Math.max(from, since) / DAY) - 1; day <= Math.floor(to / DAY); day++) {
    if (hash01(day, 71) >= 0.2) continue;
    const start = day * DAY + Math.floor(hash01(day, 73) * 22 * HOUR);
    const end = start + 40 + Math.floor(hash01(day, 79) * 560);
    out.push({ start, end, cause: CAUSES[Math.floor(hash01(day, 83) * 3)] });
  }
  const recent = Math.floor((ctx.now - 5 * HOUR) / HOUR) * HOUR + 1_234;
  out.push({ start: recent, end: recent + 95, cause: 'redial' });
  return out
    .filter((o) => o.start >= since && o.start < ctx.now && o.end > from && o.start < to)
    .map((o) => ({ ...o, end: Math.min(o.end, ctx.now) }))
    .sort((a, b) => a.start - b.start);
}

/** Share of [a, b) inside an outage that cuts `target` off (the next hop still answers when upstream fails). */
function downShare(outages: DemoOutage[], target: number, a: number, b: number): number {
  let down = 0;
  for (const o of outages) {
    if (o.cause === 'upstream' && target === 0) continue;
    down += Math.max(0, Math.min(b, o.end) - Math.max(a, o.start));
  }
  return Math.min(1, down / (b - a));
}

const EVENING = [
  0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.5, 0.5, 0.5, 0.6, 0.6, 0.6, 0.5, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 0.9, 0.5,
];

/** One bucket of one target: average and worst round trip, loss in percent; null when not probed. */
function bucket(ctx: Ctx, outages: DemoOutage[], target: number, a: number, b: number) {
  const since = ctx.state.agent.dataSince;
  const from = Math.max(a, since);
  const to = Math.min(b, ctx.now);
  if (to <= from) return null;
  const t = TARGETS[target];
  const load = EVENING[localHour(from)];
  const avg = t.base * (1 + 0.5 * load) + t.base * 0.3 * hash01(target, Math.floor(from / MINUTE), 89);
  const max = avg * (1.4 + 2 * hash01(target, Math.floor(from / MINUTE), 97));
  const share = downShare(outages, target, from, to);
  const sent = Math.max(1, Math.round((to - from) / 10));
  const background = hash01(target, Math.floor(from / MINUTE), 101) < 0.02 ? 1 / 6 : 0;
  const lost = Math.min(sent, Math.round(sent * (share + (1 - share) * background)));
  return {
    sent,
    lost,
    avg: lost === sent ? null : Math.round(avg * 10) / 10,
    max: lost === sent ? null : Math.round(max * 10) / 10,
  };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const invalid = () => new UbusError('INVALID_ARGUMENT', 'routelink');

function range(p: Record<string, unknown>) {
  const start = num(p.start);
  const end = num(p.end);
  if (start === undefined || end === undefined || start >= end) throw invalid();
  return { start, end };
}

function latency(ctx: Ctx, p: Record<string, unknown>) {
  const { start, end } = range(p);
  const maxPoints = num(p.max_points) ?? 500;
  if (maxPoints < 1 || maxPoints > 1000) throw invalid();
  const targets = p.target === undefined ? TARGETS : TARGETS.filter((t) => t.ip === p.target);
  if (!targets.length) throw new UbusError('NOT_FOUND', 'routelink');
  const tier = start >= ctx.now - LATENCY_RETENTION.latency_minute_days * DAY ? 'minute' : 'hour';
  const unit = tier === 'minute' ? MINUTE : HOUR;
  const first = Math.floor(start / unit) * unit;
  const step = unit * Math.max(1, Math.ceil((end - first) / unit / maxPoints));
  const outages = outagesBetween(ctx, first, end);
  const series = targets.map((t) => {
    let sent = 0;
    let lost = 0;
    let sum = 0;
    let max = 0;
    const points: (number | null)[][] = [];
    for (let a = first; a < end; a += step) {
      const v = bucket(ctx, outages, t.id, a, a + step);
      if (!v) {
        points.push([a, null, null, null]);
        continue;
      }
      points.push([a, v.avg, v.max, Math.round((v.lost / v.sent) * 1000) / 10]);
      sent += v.sent;
      lost += v.lost;
      if (v.avg !== null) sum += v.avg * (v.sent - v.lost);
      if (v.max !== null) max = Math.max(max, v.max);
    }
    return {
      points: { target: t.id, points },
      summary: {
        target: t.id,
        sent,
        lost,
        avg_ms: sent > lost ? Math.round((sum / (sent - lost)) * 10) / 10 : null,
        max_ms: sent > lost ? max : null,
      },
    };
  });
  return {
    start,
    end,
    step,
    tier,
    targets: targets.map(({ id, ip, kind }) => ({ id, ip, kind })),
    series: series.map((s) => s.points),
    summary: series.map((s) => s.summary),
  };
}

function outages(ctx: Ctx, p: Record<string, unknown>) {
  const { start, end } = range(p);
  const list = outagesBetween(ctx, start, end);
  const from = Math.max(start, ctx.state.agent.dataSince);
  const to = Math.min(end, ctx.now);
  const total = list.reduce((s, o) => s + Math.min(o.end, to) - Math.max(o.start, from), 0);
  return {
    count: list.length,
    total_sec: total,
    availability: to > from ? Math.round((1 - total / (to - from)) * 10_000) / 100 : null,
    outages: list
      .map((o) => ({
        start: o.start,
        end: o.end,
        duration: o.end - o.start,
        cause: o.cause,
        ongoing: false,
      }))
      .reverse(),
  };
}

/** WAN down/up events for the outages that dropped the WAN (redials come back on their own). */
export function wanEvents(ctx: Ctx, from: number, to: number) {
  return outagesBetween(ctx, from, to)
    .filter((o) => o.cause !== 'upstream')
    .flatMap((o) => [
      { ts: o.start, type: 'wan_down' },
      { ts: o.cause === 'redial' ? o.start + 25 : o.end, type: 'wan_up' },
    ])
    .filter((e) => e.ts >= from && e.ts < to);
}

// ---- router speed test ----

export interface DemoSpeedRun {
  id: number;
  started: number;
  server: string;
}

export interface DemoDiag {
  runs: DemoSpeedRun[];
}

export const createDemoDiag = (): DemoDiag => ({ runs: [] });

const PHASES = [
  ['latency', 2],
  ['download', 12],
  ['upload', 22],
] as const;
const RUN_SECONDS = 22;

function speedResult(ctx: Ctx, run: DemoSpeedRun) {
  const k = hash01(run.id, run.started, 103);
  return {
    id: run.id,
    ts: run.started,
    server: run.server,
    latency_ms: Math.round((8.2 + 2 * k) * 10) / 10,
    jitter_ms: Math.round((0.8 + k) * 10) / 10,
    down_bps: Math.round((455 + 40 * k) * 1e6),
    up_bps: Math.round((48 + 6 * k) * 1e6),
  };
}

/** Earlier tests that came with the demo. */
const pastRuns = (ctx: Ctx): DemoSpeedRun[] =>
  [20, 9, 2].map((days, i) => ({ id: i + 1, started: ctx.now - days * DAY - 3 * HOUR, server: '' }));

function speedStart(ctx: Ctx, p: Record<string, unknown>) {
  const running = ctx.state.diag.runs.find((r) => ctx.now < r.started + RUN_SECONDS);
  if (running) return { id: running.id, already: true };
  const id = 4 + ctx.state.diag.runs.length;
  ctx.state.diag.runs.push({ id, started: ctx.now, server: typeof p.server === 'string' ? p.server : '' });
  return { id };
}

function speedStatus(ctx: Ctx, p: Record<string, unknown>) {
  const all = [...pastRuns(ctx), ...ctx.state.diag.runs];
  if (p.id !== undefined) {
    const run = all.find((r) => r.id === p.id);
    if (!run) throw new UbusError('NOT_FOUND', 'routelink');
    const elapsed = ctx.now - run.started;
    if (elapsed >= RUN_SECONDS)
      return { id: run.id, running: false, phase: 'done', progress: 1, result: speedResult(ctx, run) };
    const phase = PHASES.find(([, until]) => elapsed < until)![0];
    return { id: run.id, running: true, phase, progress: Math.round((elapsed / RUN_SECONDS) * 100) / 100 };
  }
  return {
    running: all.some((r) => ctx.now < r.started + RUN_SECONDS),
    results: all
      .filter((r) => ctx.now >= r.started + RUN_SECONDS)
      .map((r) => speedResult(ctx, r))
      .reverse(),
  };
}

type Handler = (state: DemoState, params: Record<string, unknown>, now: number) => unknown;
const ctxOf = (state: DemoState, nowMs: number): Ctx => ({ state, now: Math.floor(nowMs / 1000) });
const installed =
  (fn: (ctx: Ctx, p: Record<string, unknown>) => unknown): Handler =>
  (s, p, nowMs) => {
    if (!s.agent.installed) throw new UbusError('PERMISSION_DENIED', 'routelink');
    return fn(ctxOf(s, nowMs), p);
  };

export const diagAgentHandlers: Record<string, Handler> = {
  'routelink.latency': installed(latency),
  'routelink.outages': installed(outages),
  'routelink.speedtest_start': installed(speedStart),
  'routelink.speedtest_status': installed(speedStatus),
};

// ---- ping, traceroute, nslookup ----

type Exec = (s: DemoState, args: string[], now: number) => { code: number; stdout?: string; stderr?: string };

const LAN = /^192\.168\.8\.(\d+)$/;

/** Round trip to a host from `side`, or null when it does not answer. */
function rttTo(host: string, side: 'gateway' | 'ap'): number | null {
  if (host.endsWith('.invalid')) return null;
  const lan = LAN.exec(host);
  if (lan) return Number(lan[1]) > 200 ? null : side === 'ap' ? 1.3 : 0.4;
  if (host === '203.0.113.1') return 2.2;
  const h = [...host].reduce((s, c) => s + c.charCodeAt(0), 0);
  return 6 + (h % 45) + (side === 'ap' ? 1 : 0);
}

const isV6 = (host: string) => host.includes(':');
const addressOf = (host: string) => {
  if (/^[\d.]+$/.test(host) || isV6(host)) return host;
  const h = [...host].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `${100 + (h % 120)}.${(h >> 8) % 256}.${(h >> 16) % 256}.${((h >> 24) % 250) + 1}`;
};

function ping(side: 'gateway' | 'ap', v6: boolean): Exec {
  return (_s, args) => {
    const host = args[args.length - 1];
    const count = Number(args[args.indexOf('-c') + 1]) || 4;
    if (host.endsWith('.invalid')) return { code: 1, stderr: `ping: bad address '${host}'\n` };
    if (v6 !== isV6(addressOf(host)) && /^[\d.:]+$/.test(host))
      return { code: 1, stderr: 'ping: sendto: Network unreachable\n' };
    const ip = addressOf(host);
    const base = rttTo(ip, side);
    const lines = [`PING ${host} (${ip}): 56 data bytes`];
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      if (base === null) continue;
      const t = Math.round(base * (0.85 + 0.3 * hash01(i, ip.length, 107)) * 1000) / 1000;
      times.push(t);
      lines.push(`64 bytes from ${ip}: seq=${i} ttl=${LAN.test(ip) ? 64 : 54} time=${t.toFixed(3)} ms`);
    }
    lines.push('', `--- ${host} ping statistics ---`);
    const loss = Math.round(((count - times.length) / count) * 100);
    lines.push(`${count} packets transmitted, ${times.length} packets received, ${loss}% packet loss`);
    if (times.length) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      lines.push(
        `round-trip min/avg/max = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)} ms`,
      );
    }
    return { code: times.length ? 0 : 1, stdout: `${lines.join('\n')}\n` };
  };
}

function traceroute(side: 'gateway' | 'ap'): Exec {
  return (_s, args) => {
    const host = args[args.length - 1];
    if (host.endsWith('.invalid')) return { code: 1, stderr: `traceroute: bad address '${host}'\n` };
    const ip = addressOf(host);
    const path = [...(side === 'ap' ? ['192.168.8.1'] : []), '203.0.113.1', '100.64.0.1', '*', '202.97.12.34', ip];
    const end = rttTo(ip, side) ?? 30;
    const hops = LAN.test(ip) ? [ip] : path;
    const lines = hops.map((h, i) =>
      h === '*'
        ? `${String(i + 1).padStart(2)}  *`
        : `${String(i + 1).padStart(2)}  ${h}  ${((end * (i + 1)) / hops.length).toFixed(3)} ms`,
    );
    return {
      code: 0,
      stderr: `traceroute to ${host} (${ip}), 20 hops max, 46 byte packets\n`,
      stdout: `${lines.join('\n')}\n`,
    };
  };
}

const nslookup: Exec = (_s, args) => {
  const host = args[0];
  const server = args[1] ?? '127.0.0.1';
  const head = `Server:\t\t${server}\nAddress:\t${server}:53\n\n`;
  if (host.endsWith('.invalid')) return { code: 1, stdout: `${head}** server can't find ${host}: NXDOMAIN\n` };
  return {
    code: 0,
    stdout: `${head}Non-authoritative answer:\nName:\t${host}\nAddress: ${addressOf(host)}\n\n`,
  };
};

/** `file exec` commands of the LuCI diagnostics ACL. */
export const diagCommands = (side: 'gateway' | 'ap'): Record<string, Exec> => ({
  '/bin/ping': ping(side, false),
  '/bin/ping6': ping(side, true),
  '/bin/traceroute': traceroute(side),
  '/bin/traceroute6': traceroute(side),
  '/usr/bin/nslookup': nslookup,
});
