import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import { list, mac, num, obj, optional, str, strings } from './agent-parse';
import type { QuotaPeriod } from './agent-rules';

/** Quotas, destinations, DNS log and push status of the plugin (P4, plan §1.2). */

export type QuotaState = 'ok' | 'warned' | 'exceeded' | 'allowed';

export interface QuotaUsage {
  section: string;
  mac: string;
  period: QuotaPeriod;
  periodStart: number;
  periodEnd: number;
  /** bytes */
  limit: number;
  used: number;
  pct: number;
  state: QuotaState;
  /** Temporarily allowed until (epoch seconds), 0 when not. */
  allowUntil: number;
  action: 'block' | 'limit';
}

export interface Destination {
  host?: string;
  ip: string;
  rx: number;
  tx: number;
  conns: number;
}

export interface DnsRecord {
  ts: number;
  mac: string;
  name: string;
  type: string;
  rcode: string;
  answers: string[];
}

export interface ChannelStatus {
  section: string;
  lastOk: number;
  lastError: string;
  lastErrorTs: number;
}

const STATES: readonly QuotaState[] = ['ok', 'warned', 'exceeded', 'allowed'];
const PERIODS: readonly QuotaPeriod[] = ['day', 'week', 'month'];

export function parseQuotas(raw: unknown): QuotaUsage[] {
  return list(obj(raw).quotas).map((x) => {
    const q = obj(x);
    return {
      section: str(q.section),
      mac: mac(q.mac),
      period: PERIODS.includes(q.period as QuotaPeriod) ? (q.period as QuotaPeriod) : 'month',
      periodStart: num(q.period_start),
      periodEnd: num(q.period_end),
      limit: num(q.limit),
      used: num(q.used),
      pct: num(q.pct),
      state: STATES.includes(q.state as QuotaState) ? (q.state as QuotaState) : 'ok',
      allowUntil: num(q.allow_until),
      action: q.action === 'limit' ? 'limit' : 'block',
    };
  });
}

export const parseDestinations = (raw: unknown): Destination[] =>
  list(obj(raw).destinations).map((x) => {
    const d = obj(x);
    return { host: optional(d.host), ip: str(d.ip), rx: num(d.rx), tx: num(d.tx), conns: num(d.conns) };
  });

export function parseDnsLog(raw: unknown): { count: number; records: DnsRecord[] } {
  const r = obj(raw);
  return {
    count: num(r.count),
    records: list(r.records).map((x) => {
      const d = obj(x);
      return {
        ts: num(d.ts),
        mac: mac(d.mac),
        name: str(d.name),
        type: str(d.type),
        rcode: str(d.rcode),
        answers: strings(d.answers),
      };
    }),
  };
}

export function parseNotifyStatus(raw: unknown): { channels: ChannelStatus[]; pending: number } {
  const r = obj(raw);
  return {
    pending: num(r.pending),
    channels: list(r.channels).map((x) => {
      const c = obj(x);
      return {
        section: str(c.section),
        lastOk: num(c.last_ok),
        lastError: str(c.last_error),
        lastErrorTs: num(c.last_error_ts),
      };
    }),
  };
}

export async function agentQuotas(conn: RouterConnection): Promise<QuotaUsage[]> {
  return parseQuotas(await conn.call('routelink', 'quotas'));
}

/** Lets a blocked or limited device through for an hour or until its period ends. */
export async function allowQuota(conn: RouterConnection, section: string, until: 'hour' | 'period'): Promise<void> {
  await conn.call('routelink', 'quota_allow', { section, until });
}

export async function agentDestinations(
  conn: RouterConnection,
  q: { mac: string; start: number; end: number; limit?: number },
): Promise<Destination[]> {
  try {
    return parseDestinations(
      await conn.call('routelink', 'destinations', { mac: q.mac, start: q.start, end: q.end, limit: q.limit ?? 100 }),
    );
  } catch (error) {
    if (error instanceof UbusError && error.code === 'NOT_FOUND') return [];
    throw error;
  }
}

export interface DnsQuery {
  mac?: string;
  start: number;
  end: number;
  /** Substring of the name */
  q?: string;
  limit?: number;
  offset?: number;
}

export async function agentDnsLog(
  conn: RouterConnection,
  q: DnsQuery,
): Promise<{ count: number; records: DnsRecord[] }> {
  const params: Record<string, unknown> = { start: q.start, end: q.end, limit: q.limit ?? 100, offset: q.offset ?? 0 };
  if (q.mac) params.mac = q.mac;
  if (q.q) params.q = q.q;
  return parseDnsLog(await conn.call('routelink', 'dns', params));
}

/** Sends a test message synchronously (the plugin waits up to 15 s). */
export async function testChannel(conn: RouterConnection, section: string): Promise<{ ok: boolean; error?: string }> {
  const r = obj(await conn.call('routelink', 'notify_test', { section }, { timeoutMs: 25_000 }));
  return { ok: r.ok === true, error: optional(r.error) };
}

export async function notifyStatus(conn: RouterConnection): Promise<{ channels: ChannelStatus[]; pending: number }> {
  return parseNotifyStatus(await conn.call('routelink', 'notify_status'));
}
