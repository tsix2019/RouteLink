import type { RouterConnection } from '../connection/types';
import { list, nullable, num, obj, optional, str } from './agent-parse';

/** Latency probes, outage log and router-side speed tests of the plugin (P3, plan §1). */

export type ProbeKind = 'gateway' | 'custom';

export interface ProbeTarget {
  id: number;
  ip: string;
  kind: ProbeKind;
}

export interface LatencyPoint {
  t: number;
  /** ms; null where nothing was measured */
  avg: number | null;
  max: number | null;
  /** 0–100 */
  loss: number | null;
}

export interface LatencySummary {
  target: number;
  sent: number;
  lost: number;
  avgMs: number | null;
  maxMs: number | null;
}

export interface LatencyHistory {
  start: number;
  end: number;
  step: number;
  tier: 'minute' | 'hour';
  targets: ProbeTarget[];
  series: { target: number; points: LatencyPoint[] }[];
  summary: LatencySummary[];
}

export type OutageCause = 'wan_down' | 'redial' | 'upstream';

export interface Outage {
  start: number;
  end: number;
  duration: number;
  cause: OutageCause;
  ongoing: boolean;
}

export interface OutageLog {
  count: number;
  totalSec: number;
  /** Percent of the probed time the internet was reachable; null without probe data. */
  availability: number | null;
  outages: Outage[];
}

export type SpeedPhase = 'latency' | 'download' | 'upload' | 'done' | 'failed';

export interface RouterSpeedResult {
  id: number;
  ts: number;
  server: string;
  latencyMs: number | null;
  jitterMs: number | null;
  /** bits per second */
  downBps: number | null;
  upBps: number | null;
  error?: string;
}

export interface SpeedRun {
  id: number;
  running: boolean;
  phase: SpeedPhase;
  /** 0–1 */
  progress: number;
  result?: RouterSpeedResult;
  error?: string;
}

const KINDS: readonly ProbeKind[] = ['gateway', 'custom'];
const CAUSES: readonly OutageCause[] = ['wan_down', 'redial', 'upstream'];
const PHASES: readonly SpeedPhase[] = ['latency', 'download', 'upload', 'done', 'failed'];

export function parseLatency(raw: unknown): LatencyHistory {
  const r = obj(raw);
  return {
    start: num(r.start),
    end: num(r.end),
    step: num(r.step),
    tier: r.tier === 'hour' ? 'hour' : 'minute',
    targets: list(r.targets).map((x) => {
      const t = obj(x);
      return {
        id: num(t.id),
        ip: str(t.ip),
        kind: KINDS.includes(t.kind as ProbeKind) ? (t.kind as ProbeKind) : 'custom',
      };
    }),
    series: list(r.series).map((x) => {
      const s = obj(x);
      return {
        target: num(s.target),
        points: list(s.points)
          .filter((p): p is unknown[] => Array.isArray(p) && typeof p[0] === 'number')
          .map(([t, avg, max, loss]) => ({
            t: t as number,
            avg: nullable(avg),
            max: nullable(max),
            loss: nullable(loss),
          })),
      };
    }),
    summary: list(r.summary).map((x) => {
      const s = obj(x);
      return {
        target: num(s.target),
        sent: num(s.sent),
        lost: num(s.lost),
        avgMs: nullable(s.avg_ms),
        maxMs: nullable(s.max_ms),
      };
    }),
  };
}

export function parseOutages(raw: unknown): OutageLog {
  const r = obj(raw);
  return {
    count: num(r.count),
    totalSec: num(r.total_sec),
    availability: nullable(r.availability),
    outages: list(r.outages).map((x) => {
      const o = obj(x);
      return {
        start: num(o.start),
        end: num(o.end),
        duration: num(o.duration),
        cause: CAUSES.includes(o.cause as OutageCause) ? (o.cause as OutageCause) : 'upstream',
        ongoing: o.ongoing === true,
      };
    }),
  };
}

const parseSpeedResult = (x: unknown): RouterSpeedResult => {
  const s = obj(x);
  return {
    id: num(s.id),
    ts: num(s.ts),
    server: str(s.server),
    latencyMs: nullable(s.latency_ms),
    jitterMs: nullable(s.jitter_ms),
    downBps: nullable(s.down_bps),
    upBps: nullable(s.up_bps),
    error: optional(s.error),
  };
};

export function parseSpeedRun(raw: unknown): SpeedRun {
  const r = obj(raw);
  return {
    id: num(r.id),
    running: r.running === true,
    phase: PHASES.includes(r.phase as SpeedPhase) ? (r.phase as SpeedPhase) : 'failed',
    progress: Math.min(1, Math.max(0, num(r.progress))),
    result: r.result === undefined ? undefined : parseSpeedResult(r.result),
    error: optional(r.error),
  };
}

export const parseSpeedHistory = (raw: unknown): { running: boolean; results: RouterSpeedResult[] } => {
  const r = obj(raw);
  return { running: r.running === true, results: list(r.results).map(parseSpeedResult) };
};

export interface LatencyQuery {
  start: number;
  end: number;
  /** IP of one target; all when omitted. */
  target?: string;
  maxPoints?: number;
}

export async function agentLatency(conn: RouterConnection, q: LatencyQuery): Promise<LatencyHistory> {
  const params: Record<string, unknown> = { start: q.start, end: q.end };
  if (q.target) params.target = q.target;
  if (q.maxPoints) params.max_points = q.maxPoints;
  return parseLatency(await conn.call('routelink', 'latency', params));
}

export async function agentOutages(conn: RouterConnection, q: { start: number; end: number }): Promise<OutageLog> {
  return parseOutages(await conn.call('routelink', 'outages', { start: q.start, end: q.end }));
}

/**
 * Starts a router-side speed test. When one is already running the plugin answers with that run's id and
 * `already: true` (libubus has no "busy" status).
 */
export async function startRouterSpeedtest(
  conn: RouterConnection,
  server?: string,
): Promise<{ id: number; already: boolean }> {
  const r = obj(await conn.call('routelink', 'speedtest_start', server ? { server } : {}));
  return { id: num(r.id), already: r.already === true };
}

export async function routerSpeedRun(conn: RouterConnection, id: number): Promise<SpeedRun> {
  return parseSpeedRun(await conn.call('routelink', 'speedtest_status', { id }));
}

export async function routerSpeedHistory(
  conn: RouterConnection,
): Promise<{ running: boolean; results: RouterSpeedResult[] }> {
  return parseSpeedHistory(await conn.call('routelink', 'speedtest_status', {}));
}

/** Overall loss of a summary row in percent (null when nothing was sent). */
export const lossPct = (s: Pick<LatencySummary, 'sent' | 'lost'>): number | null =>
  s.sent ? (s.lost / s.sent) * 100 : null;

/** Rounds a ms value for display like the plugin does (one decimal). */
export const ms1 = (v: number | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Math.round(v * 10) / 10;
