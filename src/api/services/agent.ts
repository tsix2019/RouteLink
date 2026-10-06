import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import { bool, bps, list, mac, nullable, num, obj, optional, str, strings } from './agent-parse';

/** Plugin API versions (`info.api`) this app understands; outside the range the user upgrades one side. */
export const AGENT_API = { min: 1, max: 1 } as const;
/** Shipped by the routelinkd package; tells "not installed" from "installed but not running". */
export const AGENT_BINARY = '/usr/sbin/routelinkd';

export type AgentOffload = 'none' | 'software' | 'hardware' | 'sfe';
export type AgentRole = 'gateway' | 'ap';
/** Modules of the plugin; `capabilities` lists what a build supports, `modules` what is switched on. */
export type AgentModule = 'traffic' | 'wifi' | 'latency' | 'speedtest' | 'limits' | 'quotas' | 'dns' | 'notify';

export interface AgentInfo {
  version: string;
  api: number;
  roles: AgentRole[];
  modules: string[];
  /** Every module this plugin build supports (P2 on); 0.1.0 only knew traffic and did not report it. */
  capabilities: string[];
  offload: AgentOffload;
  /** Hardware offloading (or similar) hides traffic from conntrack: totals may come out low. */
  offloadWarning: boolean;
  nlbwmonRunning: boolean;
  /** nf_conntrack_acct; without it every counter stays at zero. */
  conntrackAccounting: boolean;
  timeSynced: boolean;
  zonename: string;
  dataDir: string;
  storage: { usedBytes: number; limitBytes: number };
  commitIntervalSec: number;
  /** Epoch seconds; 0 = not written yet. */
  lastCommit: number;
  sampleIntervalSec: number;
  liveIntervalSec: number;
  liveUntil: number;
  started: number;
  retention: {
    minuteHours: number;
    hourDays: number;
    dayDays: number;
    eventDays: number;
    signalMinuteDays?: number;
    signalHourDays?: number;
  };
}

export interface AgentDevice {
  mac: string;
  name?: string;
  hostname?: string;
  ipv4: string[];
  ipv6: string[];
  firstSeen: number;
  lastSeen: number;
  online: boolean;
  randomMac: boolean;
  trusted: boolean;
  /** Push a notice when it comes and goes (UCI `device.watch`). */
  watch: boolean;
  /** On an access point: the interface the station is associated with, and its signal. */
  ifname?: string;
  signal?: number;
  /** Bytes since local midnight. */
  today: { rx: number; tx: number };
  /** Bits per second. */
  rate: { rxBps: number; txBps: number };
}

export type TrafficClass = 'internet' | 'lan' | 'router' | 'wan' | 'all';
export type Tier = 'minute' | 'hour' | 'day' | 'month';

export interface HistoryQuery {
  mac?: string;
  start: number;
  end: number;
  cls?: TrafficClass;
  /** Bit n set: include hour n of each day (router time zone). */
  hoursMask?: number;
  maxPoints?: number;
}

export interface HistoryPoint {
  t: number;
  /** Bytes in the step; null where the router has no data (powered off, not installed yet). */
  rx: number | null;
  tx: number | null;
}

export interface History {
  start: number;
  end: number;
  /** Seconds per point. */
  step: number;
  tier: Tier;
  points: HistoryPoint[];
}

export interface SummaryQuery {
  start: number;
  end: number;
  cls?: Exclude<TrafficClass, 'wan'>;
  hoursMask?: number;
  sort?: 'total' | 'rx' | 'tx';
  limit?: number;
  offset?: number;
}

export interface Summary {
  /** Older data only exists in coarser buckets: the totals start here, not at the requested start. */
  startExact: number;
  end: number;
  granularity: Tier;
  rx: number;
  tx: number;
  wanRx: number;
  wanTx: number;
  /** Devices in the range (the page in `devices` may be shorter). */
  count: number;
  devices: { mac: string; rx: number; tx: number }[];
  truncated: boolean;
}

export interface Live {
  ts: number;
  leaseUntil: number;
  intervalSec: number;
  wan: { rxBps: number; txBps: number };
  online: number;
  /** Busiest first. */
  devices: { mac: string; rxBps: number; txBps: number }[];
}

export type AgentEventType =
  | 'device_new'
  | 'device_online'
  | 'device_offline'
  | 'daemon_start'
  | 'time_jump'
  | 'commit_failed'
  | 'data_recovered'
  /** value: frequency (MHz) of the interface */
  | 'wifi_connect'
  | 'wifi_disconnect';

export interface AgentEvent {
  ts: number;
  type: AgentEventType | string;
  mac?: string;
  value?: number;
}

export interface EventsQuery {
  start: number;
  end: number;
  types?: AgentEventType[];
  mac?: string;
  limit?: number;
  offset?: number;
}

// ---- parsing: never throw on odd input, fall back to safe defaults ----

const OFFLOADS: readonly AgentOffload[] = ['none', 'software', 'hardware', 'sfe'];
const TIERS: readonly Tier[] = ['minute', 'hour', 'day', 'month'];
const tier = (v: unknown): Tier => (TIERS.includes(v as Tier) ? (v as Tier) : 'minute');

export function parseInfo(raw: unknown): AgentInfo {
  const r = obj(raw);
  const ret = obj(r.retention);
  return {
    version: str(r.version, '?'),
    api: num(r.api),
    roles: strings(r.roles).filter((x): x is AgentRole => x === 'gateway' || x === 'ap'),
    modules: strings(r.modules),
    capabilities: r.capabilities === undefined ? ['traffic'] : strings(r.capabilities),
    offload: OFFLOADS.includes(r.offload as AgentOffload) ? (r.offload as AgentOffload) : 'none',
    offloadWarning: bool(r.offload_warning),
    nlbwmonRunning: bool(r.nlbwmon_running),
    // Absent on builds before the field existed: assume counting works rather than warn wrongly.
    conntrackAccounting: r.conntrack_accounting === undefined ? true : bool(r.conntrack_accounting),
    timeSynced: r.time_synced === undefined ? true : bool(r.time_synced),
    zonename: str(r.zonename),
    dataDir: str(r.data_dir),
    storage: { usedBytes: num(r.storage_used), limitBytes: num(r.storage_limit) },
    commitIntervalSec: num(r.commit_interval),
    lastCommit: num(r.last_commit),
    sampleIntervalSec: num(r.sample_interval),
    liveIntervalSec: num(r.live_interval, 2),
    liveUntil: num(r.live_until),
    started: num(r.started),
    retention: {
      minuteHours: num(ret.minute_hours),
      hourDays: num(ret.hour_days),
      dayDays: num(ret.day_days),
      eventDays: num(ret.event_days),
      signalMinuteDays: ret.signal_minute_days === undefined ? undefined : num(ret.signal_minute_days),
      signalHourDays: ret.signal_hour_days === undefined ? undefined : num(ret.signal_hour_days),
    },
  };
}

export function parseDevices(raw: unknown): AgentDevice[] {
  return list(obj(raw).devices).map((d) => {
    const r = obj(d);
    return {
      mac: mac(r.mac),
      name: optional(r.name),
      hostname: optional(r.hostname),
      ipv4: strings(r.ipv4),
      ipv6: strings(r.ipv6),
      firstSeen: num(r.first_seen),
      lastSeen: num(r.last_seen),
      online: bool(r.online),
      randomMac: bool(r.random_mac),
      trusted: bool(r.trusted),
      watch: bool(r.watch),
      ifname: optional(r.ifname),
      signal: typeof r.signal === 'number' ? r.signal : undefined,
      today: { rx: num(r.today_rx), tx: num(r.today_tx) },
      rate: { rxBps: bps(r.rx_rate), txBps: bps(r.tx_rate) },
    };
  });
}

export function parseLive(raw: unknown): Live {
  const r = obj(raw);
  const wan = obj(r.wan);
  return {
    ts: num(r.ts),
    leaseUntil: num(r.lease_until),
    intervalSec: num(r.interval, 2),
    wan: { rxBps: bps(wan.rx_rate), txBps: bps(wan.tx_rate) },
    online: num(r.online),
    devices: list(r.devices).map((d) => {
      const x = obj(d);
      return { mac: mac(x.mac), rxBps: bps(x.rx_rate), txBps: bps(x.tx_rate) };
    }),
  };
}

export function parseHistory(raw: unknown): History {
  const r = obj(raw);
  return {
    start: num(r.start),
    end: num(r.end),
    step: num(r.step),
    tier: tier(r.tier),
    points: list(r.points)
      .filter((p): p is unknown[] => Array.isArray(p) && typeof p[0] === 'number')
      .map(([t, rx, tx]) => ({ t: t as number, rx: nullable(rx), tx: nullable(tx) })),
  };
}

export function parseSummary(raw: unknown): Summary {
  const r = obj(raw);
  const devices = list(r.devices).map((d) => {
    const x = obj(d);
    return { mac: mac(x.mac), rx: num(x.rx), tx: num(x.tx) };
  });
  return {
    startExact: num(r.start_exact),
    end: num(r.end),
    granularity: tier(r.granularity),
    rx: num(r.rx),
    tx: num(r.tx),
    wanRx: num(r.wan_rx),
    wanTx: num(r.wan_tx),
    count: num(r.count, devices.length),
    devices,
    truncated: bool(r.truncated),
  };
}

export function parseEvents(raw: unknown): { count: number; events: AgentEvent[] } {
  const r = obj(raw);
  const events = list(r.events).map((e) => {
    const x = obj(e);
    return {
      ts: num(x.ts),
      type: str(x.type, 'unknown'),
      mac: x.mac === undefined ? undefined : mac(x.mac),
      value: x.value === undefined ? undefined : num(x.value),
    };
  });
  return { count: num(r.count, events.length), events };
}

// ---- calls ----

export async function getAgentInfo(conn: RouterConnection): Promise<AgentInfo> {
  return parseInfo(await conn.call('routelink', 'info'));
}

export async function getAgentDevices(conn: RouterConnection): Promise<AgentDevice[]> {
  return parseDevices(await conn.call('routelink', 'devices'));
}

/** Also renews the plugin's 30-second live lease: while someone polls, it samples every 2 seconds. */
export async function agentLive(conn: RouterConnection): Promise<Live> {
  return parseLive(await conn.call('routelink', 'live'));
}

export async function agentHistory(conn: RouterConnection, q: HistoryQuery): Promise<History> {
  const params: Record<string, unknown> = { start: q.start, end: q.end };
  if (q.cls) params.class = q.cls;
  if (q.mac) params.mac = q.mac;
  if (q.hoursMask) params.hours = q.hoursMask;
  if (q.maxPoints) params.max_points = q.maxPoints;
  try {
    return parseHistory(await conn.call('routelink', 'history', params));
  } catch (error) {
    // A device the plugin has never seen has no history, which is not an error for the UI.
    if (q.mac && error instanceof UbusError && error.code === 'NOT_FOUND') {
      return { start: q.start, end: q.end, step: 0, tier: 'minute', points: [] };
    }
    throw error;
  }
}

export async function agentSummary(conn: RouterConnection, q: SummaryQuery): Promise<Summary> {
  const params: Record<string, unknown> = { start: q.start, end: q.end };
  if (q.cls) params.class = q.cls;
  if (q.hoursMask) params.hours = q.hoursMask;
  if (q.sort) params.sort = q.sort;
  if (q.limit) params.limit = q.limit;
  if (q.offset) params.offset = q.offset;
  return parseSummary(await conn.call('routelink', 'summary', params));
}

export async function agentEvents(
  conn: RouterConnection,
  q: EventsQuery,
): Promise<{ count: number; events: AgentEvent[] }> {
  const params: Record<string, unknown> = { start: q.start, end: q.end };
  if (q.types?.length) params.types = q.types;
  if (q.mac) params.mac = q.mac;
  if (q.limit) params.limit = q.limit;
  if (q.offset) params.offset = q.offset;
  return parseEvents(await conn.call('routelink', 'events', params));
}

export async function agentReset(conn: RouterConnection, scope: 'traffic' | 'events' | 'devices' | 'all') {
  await conn.call('routelink', 'reset', { scope });
}

/** Writes pending data to flash now (settings button, before a firmware upgrade). */
export async function agentCommit(conn: RouterConnection) {
  await conn.call('routelink', 'commit');
}

// ---- status ----

export type AgentStatus =
  | { state: 'ok'; info: AgentInfo }
  | { state: 'not-installed' }
  /** The package is installed (its binary exists) but its ubus object is not registered. */
  | { state: 'not-running' }
  | { state: 'too-old'; info: AgentInfo }
  | { state: 'too-new'; info: AgentInfo }
  /** The account is not granted the `routelink` ACL group (non-root users). */
  | { state: 'no-permission' };

const isCode = (error: UbusError, ...codes: UbusError['code'][]) => codes.includes(error.code);

/**
 * One batch: `routelink info` and a stat of the daemon binary. Without the package there is no ACL
 * for the `routelink` object either, so "not installed" shows up as an access denial, not as "not found".
 */
export async function getAgentStatus(conn: RouterConnection): Promise<AgentStatus> {
  const [info, stat] = await conn.batch([
    { object: 'routelink', method: 'info' },
    { object: 'file', method: 'stat', params: { path: AGENT_BINARY } },
  ]);
  if (info.ok) {
    const parsed = parseInfo(info.data);
    if (parsed.api < AGENT_API.min) return { state: 'too-old', info: parsed };
    if (parsed.api > AGENT_API.max) return { state: 'too-new', info: parsed };
    return { state: 'ok', info: parsed };
  }
  const missing = !stat.ok && stat.error.code === 'NOT_FOUND';
  if (isCode(info.error, 'NOT_FOUND', 'METHOD_NOT_FOUND'))
    return missing ? { state: 'not-installed' } : { state: 'not-running' };
  if (isCode(info.error, 'PERMISSION_DENIED', 'ACCESS_DENIED')) {
    return missing ? { state: 'not-installed' } : { state: 'no-permission' };
  }
  throw info.error;
}
