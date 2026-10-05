import { UbusError } from '../../ubus/errors';
import type { DemoState } from './state';

/**
 * The router plugin on the demo router (`routelink` ubus object). Traffic comes from a deterministic model
 * instead of stored samples: every device has a rate per hour (a daily curve times a seeded random factor)
 * shaped per minute by a wave that sums to zero over the hour. Any time range therefore gives the same
 * answer every time, and totals agree at every resolution (summary = sum of history).
 */

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
/** The demo router lives in Asia/Shanghai (uci system zonename). */
const TZ_OFFSET = 8 * HOUR;
/** How long the demo plugin has been collecting. */
export const AGENT_DATA_DAYS = 120;
/** WAN counts headers and retransmissions the per-device totals don't. */
const WAN_OVERHEAD = 1.03;
const RETENTION = { minute_hours: 48, hour_days: 90, day_days: 730, event_days: 90 };

export interface DemoAgent {
  installed: boolean;
  /** Epoch seconds of the first data. */
  dataSince: number;
  /** Data before this was cleared with `reset`. */
  resetAt: number;
  lastCommit: number;
}

export const createDemoAgent = (nowMs: number): DemoAgent => {
  const now = Math.floor(nowMs / 1000);
  return { installed: true, dataSince: now - AGENT_DATA_DAYS * DAY, resetAt: 0, lastCommit: now - 300 };
};

/** Download at the evening peak in bytes/s, upload as a share of it, LAN traffic (to the NAS) at the peak. */
const PROFILES: Record<string, { rx: number; up: number; lan?: number }> = {
  'Living-Room-TV': { rx: 900_000, up: 0.03 },
  'Desk-PC': { rx: 520_000, up: 0.12, lan: 300_000 },
  'MacBook-Air': { rx: 330_000, up: 0.15, lan: 140_000 },
  'iPhone-16-Pro': { rx: 210_000, up: 0.1 },
  iPad: { rx: 160_000, up: 0.05 },
  'Pixel-9': { rx: 120_000, up: 0.1 },
  'Galaxy-S25': { rx: 110_000, up: 0.1 },
  'Nintendo-Switch': { rx: 90_000, up: 0.08 },
  ThinkPad: { rx: 140_000, up: 0.12 },
  NAS: { rx: 40_000, up: 1.5, lan: 420_000 },
  'Front-Camera': { rx: 2_000, up: 25 },
  'Sonos-One': { rx: 55_000, up: 0.02 },
  'Echo-Dot': { rx: 6_000, up: 0.4 },
  'Smart-Plug': { rx: 120, up: 1 },
  'HP-LaserJet': { rx: 200, up: 0.5, lan: 6_000 },
};

/** Relative activity per local hour: quiet at night, a peak from 20:00 to 23:00. */
const DAILY = [
  0.2, 0.13, 0.09, 0.07, 0.06, 0.07, 0.14, 0.3, 0.42, 0.46, 0.5, 0.55, 0.6, 0.55, 0.52, 0.52, 0.58, 0.68, 0.8, 0.9,
  1, 1, 0.86, 0.45,
];

/** Laptops and computers sleep at night: offline from about 00:30 to 08:30 local time. */
const SLEEPERS = new Set(['MacBook-Air', 'Desk-PC', 'ThinkPad', 'iPad']);
/** The two devices the demo lists as offline went away this long ago. */
const OFFLINE_FOR = 2 * HOUR + 53 * MINUTE;

function hash01(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

const localHour = (t: number) => Math.floor((t + TZ_OFFSET) / HOUR) % 24;
const localDay = (t: number) => Math.floor((t + TZ_OFFSET) / DAY);
const localMidnight = (t: number) => localDay(t) * DAY - TZ_OFFSET;

type Kind = 'internet' | 'lan';
type Cls = 'internet' | 'lan' | 'router' | 'all' | 'wan';
/** A device index, every device of a class, or the WAN interface. */
type Target = number | 'all' | 'wan';
type Bytes = [rx: number, tx: number];

interface Ctx {
  state: DemoState;
  now: number;
}

/** Bytes per second (download, upload) of device `i` during hour `h` (hours since the epoch). */
function hourRate(ctx: Ctx, i: number, h: number, kind: Kind): Bytes {
  const p = PROFILES[ctx.state.devices[i].hostname] ?? { rx: 20_000, up: 0.1 };
  const peak = kind === 'lan' ? (p.lan ?? 0) : p.rx;
  if (!peak) return [0, 0];
  const rx = peak * DAILY[localHour(h * HOUR)] * (0.35 + 1.3 * hash01(i, h, kind === 'lan' ? 7 : 3));
  return [rx, kind === 'lan' ? rx * 0.25 : rx * p.up];
}

/** 1 + a wave with a whole number of periods per hour: over an hour the minutes average exactly 1. */
function minuteShape(i: number, h: number, minuteOfHour: number): number {
  const k = 1 + Math.floor(hash01(i, h, 11) * 3);
  const phase = hash01(i, h, 13) * 2 * Math.PI;
  return 1 + 0.6 * Math.sin((2 * Math.PI * k * minuteOfHour) / 60 + phase);
}

function sleepWindow(i: number, day: number): [number, number] {
  return [30 * MINUTE + hash01(i, day, 17) * 40 * MINUTE, 8 * HOUR + hash01(i, day, 19) * 50 * MINUTE];
}

/** Whether device `i` is connected at `t` (sleeping laptops, the devices shown as offline). */
function present(ctx: Ctx, i: number, t: number): boolean {
  const d = ctx.state.devices[i];
  if (!d.online && t >= ctx.now - OFFLINE_FOR) return false;
  if (SLEEPERS.has(d.hostname)) {
    const [sleep, wake] = sleepWindow(i, localDay(t));
    const sinceMidnight = t - localMidnight(t);
    if (sinceMidnight >= sleep && sinceMidnight < wake) return false;
  }
  return true;
}

/** Bytes of device `i` in [a, b): whole hours at once when present throughout, otherwise minute by minute. */
function deviceBytes(ctx: Ctx, i: number, a: number, b: number, kind: Kind): Bytes {
  let rx = 0;
  let tx = 0;
  let t = a;
  while (t < b) {
    const h = Math.floor(t / HOUR);
    const hourEnd = (h + 1) * HOUR;
    const [hr, ht] = hourRate(ctx, i, h, kind);
    if (hr === 0 && ht === 0) {
      t = Math.min(b, hourEnd);
      continue;
    }
    const sleeper = SLEEPERS.has(ctx.state.devices[i].hostname);
    const offlineSoon = !ctx.state.devices[i].online && hourEnd > ctx.now - OFFLINE_FOR;
    if (t === h * HOUR && hourEnd <= b && !offlineSoon && !(sleeper && localHour(t) < 10)) {
      rx += hr * HOUR;
      tx += ht * HOUR;
      t = hourEnd;
      continue;
    }
    const minuteEnd = Math.min(b, (Math.floor(t / MINUTE) + 1) * MINUTE);
    if (present(ctx, i, t)) {
      const shape = minuteShape(i, h, Math.floor((t - h * HOUR) / MINUTE));
      rx += hr * shape * (minuteEnd - t);
      tx += ht * shape * (minuteEnd - t);
    }
    t = minuteEnd;
  }
  return [rx, tx];
}

const dataStart = (ctx: Ctx) => Math.max(ctx.state.agent.dataSince, ctx.state.agent.resetAt);

/** Bytes of a target and class in [a, b), clipped to when data exists; null when there is none. */
function bytesFor(ctx: Ctx, target: Target, cls: Cls, a: number, b: number): Bytes | null {
  const from = Math.max(a, dataStart(ctx));
  const to = Math.min(b, ctx.now);
  if (to <= from) return null;
  const devices = typeof target === 'number' ? [target] : ctx.state.devices.map((_, i) => i);
  const kinds: Kind[] = target === 'wan' ? ['internet'] : cls === 'lan' ? ['lan'] : cls === 'all' ? ['internet', 'lan'] : ['internet'];
  let rx = 0;
  let tx = 0;
  for (const i of devices) {
    for (const kind of kinds) {
      const [r, t] = deviceBytes(ctx, i, from, to, kind);
      rx += r;
      tx += t;
    }
  }
  const scale = target === 'wan' ? WAN_OVERHEAD : cls === 'router' ? 0.01 : 1;
  return [Math.round(rx * scale), Math.round(tx * scale)];
}

/** Like bytesFor, counting only the hours of day in `mask` (bit n = local hour n). */
function maskedBytes(ctx: Ctx, target: Target, cls: Cls, a: number, b: number, mask: number): Bytes | null {
  if (!mask || mask === 0xffffff) return bytesFor(ctx, target, cls, a, b);
  let total: Bytes | null = null;
  for (let t = a; t < b; ) {
    const next = Math.min(b, (Math.floor(t / HOUR) + 1) * HOUR);
    if (mask & (1 << localHour(t))) {
      const part = bytesFor(ctx, target, cls, t, next);
      if (part) total = total ? [total[0] + part[0], total[1] + part[1]] : part;
    }
    t = next;
  }
  return total;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const invalid = () => new UbusError('INVALID_ARGUMENT', 'routelink');

function deviceIndex(state: DemoState, mac: unknown): number {
  if (typeof mac !== 'string' || !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac)) throw invalid();
  const i = state.devices.findIndex((d) => d.mac === mac.toUpperCase());
  if (i < 0) throw new UbusError('NOT_FOUND', 'routelink');
  return i;
}

function range(p: Record<string, unknown>): { start: number; end: number } {
  const start = num(p.start);
  const end = num(p.end);
  if (start === undefined || end === undefined || start >= end || end - start > 3653 * DAY) throw invalid();
  return { start, end };
}

function classOf(p: Record<string, unknown>, allowWan: boolean): Cls {
  const c = (p.class ?? 'internet') as Cls;
  if (!['internet', 'lan', 'router', 'all', 'wan'].includes(c) || (c === 'wan' && !allowWan)) throw invalid();
  return c;
}

function hoursOf(p: Record<string, unknown>): number {
  const mask = num(p.hours) ?? 0;
  if (mask < 0 || mask > 0xffffff) throw invalid();
  return mask;
}

/** The finest tier that still holds the start of the range, as the plugin picks it. */
function tierFor(start: number, now: number): 'minute' | 'hour' | 'day' | 'month' {
  if (start >= now - RETENTION.minute_hours * HOUR) return 'minute';
  if (start >= now - RETENTION.hour_days * DAY) return 'hour';
  if (start >= now - RETENTION.day_days * DAY) return 'day';
  return 'month';
}

const TIER_SECONDS = { minute: MINUTE, hour: HOUR, day: DAY } as const;

function monthStarts(start: number, end: number): number[] {
  const local = new Date((start + TZ_OFFSET) * 1000);
  const out: number[] = [];
  for (let k = 0; ; k++) {
    const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + k, 1) / 1000 - TZ_OFFSET;
    if (t >= end) return out;
    out.push(t);
  }
}

function history(ctx: Ctx, p: Record<string, unknown>) {
  const { start, end } = range(p);
  const cls = classOf(p, true);
  const target: Target = cls === 'wan' ? 'wan' : p.mac !== undefined ? deviceIndex(ctx.state, p.mac) : 'all';
  const maxPoints = num(p.max_points) ?? 500;
  if (maxPoints < 1 || maxPoints > 1000) throw invalid();
  const mask = hoursOf(p);
  const tier = tierFor(start, ctx.now);
  // Like the plugin: hour-of-day filters need hourly data.
  if (mask && (tier === 'day' || tier === 'month')) throw invalid();

  let step: number;
  let buckets: number[];
  if (tier === 'month') {
    step = 30 * DAY;
    buckets = monthStarts(start, end);
  } else {
    // As the plugin does: the first bucket of the tier that holds `start`, then k tier buckets per point.
    const unit = TIER_SECONDS[tier];
    const align = tier === 'day' ? TZ_OFFSET : 0;
    const first = Math.floor((start + align) / unit) * unit - align;
    step = unit * Math.max(1, Math.ceil((end - first) / unit / maxPoints));
    buckets = [];
    for (let t = first; t < end; t += step) buckets.push(t);
  }
  const points = buckets.map((b, k) => {
    const bEnd = tier === 'month' ? (buckets[k + 1] ?? end) : b + step;
    const v = maskedBytes(ctx, target, cls, Math.max(b, start), Math.min(bEnd, end), mask);
    return [b, v ? v[0] : null, v ? v[1] : null];
  });
  return { start, end, step, tier, points };
}

function summary(ctx: Ctx, p: Record<string, unknown>) {
  const { start, end } = range(p);
  const cls = classOf(p, false);
  const mask = hoursOf(p);
  const limit = num(p.limit) ?? 50;
  const offset = num(p.offset) ?? 0;
  const sort = String(p.sort ?? 'total');
  if (limit < 1 || limit > 500 || offset < 0 || !['total', 'rx', 'tx'].includes(sort)) throw invalid();

  const devices = ctx.state.devices
    .map((d, i) => {
      const v = maskedBytes(ctx, i, cls, start, end, mask);
      return { mac: d.mac, rx: v?.[0] ?? 0, tx: v?.[1] ?? 0 };
    })
    .filter((d) => d.rx + d.tx > 0);
  const key = (d: { rx: number; tx: number }) => (sort === 'rx' ? d.rx : sort === 'tx' ? d.tx : d.rx + d.tx);
  devices.sort((a, b) => key(b) - key(a));
  const wan = maskedBytes(ctx, 'wan', 'wan', start, end, mask) ?? [0, 0];
  const tier = tierFor(start, ctx.now);
  return {
    start_exact: Math.max(start, dataStart(ctx)),
    end,
    granularity: tier === 'month' ? 'day' : tier,
    rx: devices.reduce((s, d) => s + d.rx, 0),
    tx: devices.reduce((s, d) => s + d.tx, 0),
    wan_rx: cls === 'internet' || cls === 'all' ? wan[0] : 0,
    wan_tx: cls === 'internet' || cls === 'all' ? wan[1] : 0,
    count: devices.length,
    devices: devices.slice(offset, offset + limit),
  };
}

interface Ev {
  ts: number;
  type: string;
  mac?: string;
}

/** Joins, the laptops' nightly sleep, the two devices that left, and plugin starts. */
function eventList(ctx: Ctx, start: number, end: number): Ev[] {
  const from = Math.max(start, dataStart(ctx));
  const to = Math.min(end, ctx.now + 1);
  const out: Ev[] = [];
  ctx.state.devices.forEach((d, i) => {
    out.push({ ts: ctx.state.agent.dataSince + Math.floor(hash01(i, 23) * 20 * DAY), type: 'device_new', mac: d.mac });
    if (SLEEPERS.has(d.hostname)) {
      for (let day = localDay(from) - 1; day <= localDay(to); day++) {
        const midnight = day * DAY - TZ_OFFSET;
        const [sleep, wake] = sleepWindow(i, day);
        out.push({ ts: Math.ceil(midnight + sleep), type: 'device_offline', mac: d.mac });
        out.push({ ts: Math.ceil(midnight + wake), type: 'device_online', mac: d.mac });
      }
    }
    if (!d.online) out.push({ ts: ctx.now - OFFLINE_FOR, type: 'device_offline', mac: d.mac });
  });
  out.push({ ts: ctx.state.agent.dataSince, type: 'daemon_start' });
  out.push({ ts: Math.floor(ctx.state.bootTime / 1000) + 41, type: 'daemon_start' });
  return out.filter((e) => e.ts >= from && e.ts < to).sort((a, b) => b.ts - a.ts);
}

const EVENT_TYPES = ['device_new', 'device_online', 'device_offline', 'daemon_start', 'time_jump', 'commit_failed', 'data_recovered'];

function events(ctx: Ctx, p: Record<string, unknown>) {
  const start = num(p.start) ?? 0;
  const end = num(p.end) ?? ctx.now + 1;
  const limit = num(p.limit) ?? 200;
  const offset = num(p.offset) ?? 0;
  if (start >= end || limit < 1 || limit > 1000 || offset < 0) throw invalid();
  const types = Array.isArray(p.types) ? p.types.map(String) : undefined;
  if (types?.some((t) => !EVENT_TYPES.includes(t))) throw invalid();
  let list = eventList(ctx, start, end);
  if (types) list = list.filter((e) => types.includes(e.type));
  if (p.mac !== undefined) {
    const mac = ctx.state.devices[deviceIndex(ctx.state, p.mac)].mac;
    list = list.filter((e) => e.mac === mac);
  }
  return { count: list.length, events: list.slice(offset, offset + limit) };
}

/** Each device's download/upload right now in bytes/s: the demo WAN rate split by the devices' current shares. */
function currentRates(ctx: Ctx): { mac: string; rx: number; tx: number }[] {
  const minute = Math.floor(ctx.now / MINUTE) * MINUTE;
  const h = Math.floor(minute / HOUR);
  const shares = ctx.state.devices.map((d, i) => {
    if (!present(ctx, i, ctx.now)) return { mac: d.mac, rx: 0, tx: 0 };
    const [r, t] = hourRate(ctx, i, h, 'internet');
    const shape = minuteShape(i, h, Math.floor((minute - h * HOUR) / MINUTE));
    return { mac: d.mac, rx: r * shape, tx: t * shape };
  });
  const sumRx = shares.reduce((s, x) => s + x.rx, 0) || 1;
  const sumTx = shares.reduce((s, x) => s + x.tx, 0) || 1;
  const wanRx = ctx.state.wanRate.rx / WAN_OVERHEAD;
  const wanTx = ctx.state.wanRate.tx / WAN_OVERHEAD;
  return shares.map((x) => ({
    mac: x.mac,
    rx: Math.round((x.rx / sumRx) * wanRx),
    tx: Math.round((x.tx / sumTx) * wanTx),
  }));
}

function requireInstalled(state: DemoState) {
  // Without the package there is no ACL for the object, so rpcd denies the call (like a real router).
  if (!state.agent.installed) throw new UbusError('PERMISSION_DENIED', 'routelink');
}

type Handler = (state: DemoState, params: Record<string, unknown>, nowMs: number) => unknown;
const ctxOf = (state: DemoState, nowMs: number): Ctx => ({ state, now: Math.floor(nowMs / 1000) });
const installed =
  (fn: (ctx: Ctx, p: Record<string, unknown>) => unknown): Handler =>
  (s, p, nowMs) => {
    requireInstalled(s);
    return fn(ctxOf(s, nowMs), p);
  };

export const agentHandlers: Record<string, Handler> = {
  'routelink.info': installed(({ state, now }) => ({
    version: '0.1.0',
    api: 1,
    roles: ['gateway'],
    modules: ['traffic'],
    offload: 'software',
    offload_warning: false,
    nlbwmon_running: false,
    conntrack_accounting: true,
    time_synced: true,
    zonename: 'Asia/Shanghai',
    data_dir: '/etc/routelink',
    storage_used: 2_412_544,
    storage_limit: 33_554_432,
    commit_interval: 600,
    last_commit: state.agent.lastCommit,
    sample_interval: 30,
    live_interval: 2,
    live_until: now + 30,
    started: Math.floor(state.bootTime / 1000) + 41,
    events_lost: 0,
    retention: RETENTION,
  })),
  'routelink.devices': installed((ctx) => {
    const rates = currentRates(ctx);
    const today = localMidnight(ctx.now);
    return {
      devices: ctx.state.devices.map((d, i) => {
        const used = bytesFor(ctx, i, 'internet', today, ctx.now) ?? [0, 0];
        const online = present(ctx, i, ctx.now);
        return {
          mac: d.mac,
          name: '',
          hostname: d.hostname,
          ipv4: [d.ip],
          ipv6: [],
          first_seen: ctx.state.agent.dataSince + Math.floor(hash01(i, 23) * 20 * DAY),
          last_seen: online ? ctx.now : ctx.now - OFFLINE_FOR,
          online,
          random_mac: (parseInt(d.mac.slice(0, 2), 16) & 2) === 2,
          trusted: false,
          today_rx: used[0],
          today_tx: used[1],
          rx_rate: rates[i].rx,
          tx_rate: rates[i].tx,
        };
      }),
    };
  }),
  'routelink.live': installed((ctx) => ({
    ts: ctx.now,
    lease_until: ctx.now + 30,
    interval: 2,
    wan: { rx_rate: Math.round(ctx.state.wanRate.rx), tx_rate: Math.round(ctx.state.wanRate.tx) },
    online: ctx.state.devices.filter((_, i) => present(ctx, i, ctx.now)).length,
    devices: currentRates(ctx)
      .map((r) => ({ mac: r.mac, rx_rate: r.rx, tx_rate: r.tx }))
      .filter((r) => r.rx_rate + r.tx_rate > 0)
      .sort((a, b) => b.rx_rate + b.tx_rate - (a.rx_rate + a.tx_rate)),
  })),
  'routelink.history': installed(history),
  'routelink.summary': installed(summary),
  'routelink.events': installed(events),
  'routelink.reset': installed(({ state, now }, p) => {
    if (!['traffic', 'events', 'devices', 'all'].includes(String(p.scope))) throw invalid();
    if (p.scope === 'traffic' || p.scope === 'all') state.agent.resetAt = now;
    return {};
  }),
  'routelink.commit': installed(({ state, now }) => {
    state.agent.lastCommit = now;
    return { ok: true };
  }),
};

/** LuCI's package helper on the demo router (24.10, opkg). Installing any package installs the plugin. */
export function demoPackageHelper(state: DemoState, argv: string[]): string {
  const [, action, ...args] = argv;
  const out = (code: number, stdout = '', stderr = '') => JSON.stringify({ code, stdout, stderr });
  switch (action) {
    case 'update':
      return out(0, 'Updated list of available packages in /var/opkg-lists/openwrt_base');
    case 'install':
      state.agent.installed = true;
      state.agent.resetAt = 0;
      return out(0, 'Installing routelinkd (0.1.0-r1) to root...\nConfiguring routelinkd.');
    case 'remove':
      if (args.includes('routelinkd')) state.agent.installed = false;
      return out(0, args.map((a) => `Removing package ${a} from root...`).join('\n'));
    default:
      return out(1, '', `unsupported: ${action}`);
  }
}
