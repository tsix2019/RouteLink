import { UbusError } from '../../ubus/errors';
import type { UciSection } from '../../uci';
import { bytesFor, deviceIndex } from './agent';
import { DAY, HOUR, MINUTE, TZ_OFFSET, localDay, localMidnight, present, type Ctx } from './presence';
import { hash01 } from './random';
import type { DemoDevice, DemoState } from './state';

/**
 * P4 on the demo router: speed limits and quotas (rules in the plugin's UCI, usage from the traffic model),
 * where devices go and what they look up (DNS logging is on in the demo so the pages have data), and push
 * channels whose test messages "arrive".
 */

const section = (name: string, type: string, values: Record<string, string | string[]>): UciSection =>
  ({ '.name': name, '.type': type, '.anonymous': !['dns', 'notify'].includes(name), ...values }) as UciSection;

/** UCI sections the demo plugin starts with. */
export function demoRuleSections(devices: DemoDevice[]): Record<string, UciSection> {
  const mac = (host: string) => devices.find((d) => d.hostname === host)!.mac;
  return {
    cfg_limit_switch: section('cfg_limit_switch', 'limit', {
      mac: mac('Nintendo-Switch'),
      enabled: '1',
      download: '4000',
      upload: '1000',
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      start_time: '19:00',
      stop_time: '22:00',
    }),
    cfg_quota_tv: section('cfg_quota_tv', 'quota', {
      mac: mac('Living-Room-TV'),
      enabled: '1',
      period: 'month',
      reset_day: '1',
      limit_mb: '307200',
      direction: 'download',
      action: 'limit',
      limit_download: '20000',
      limit_upload: '2000',
    }),
    cfg_quota_galaxy: section('cfg_quota_galaxy', 'quota', {
      mac: mac('Galaxy-S25'),
      enabled: '1',
      period: 'week',
      reset_day: '1',
      limit_mb: '8192',
      direction: 'total',
      action: 'block',
    }),
    dns: section('dns', 'dns', { enabled: '1', keep_days: '7', max_records: '100000' }),
    cfg_notify_bark: section('cfg_notify_bark', 'notify', {
      type: 'bark',
      enabled: '1',
      name: 'iPhone',
      url: 'https://api.day.app',
      token: 'demo-device-key',
      events: ['device_new', 'device_watch', 'quota', 'outage'],
    }),
    notify: section('notify', 'notify_settings', { lang: 'auto' }),
  };
}

export interface DemoControl {
  /** quota section → allowed until (epoch seconds) */
  allowed: Record<string, number>;
  /** notify section → last successful send */
  lastOk: Record<string, number>;
  lastError: Record<string, { error: string; ts: number }>;
}

export const createDemoControl = (): DemoControl => ({ allowed: {}, lastOk: {}, lastError: {} });

const rules = (s: DemoState) => Object.values(s.uci.routelink ?? {});
const invalid = () => new UbusError('INVALID_ARGUMENT', 'routelink');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Start and end of the quota period containing `now`, in the demo's local time (UTC+8). */
export function periodOf(now: number, period: string, resetDay: number): [number, number] {
  if (period === 'day') {
    const start = localMidnight(now);
    return [start, start + DAY];
  }
  if (period === 'week') {
    const day = localDay(now);
    // 1970-01-01 was a Thursday (weekday 4, Monday = 1).
    const weekday = ((day + 3) % 7) + 1;
    const back = (weekday - resetDay + 7) % 7;
    const start = (day - back) * DAY - TZ_OFFSET;
    return [start, start + 7 * DAY];
  }
  const local = new Date((now + TZ_OFFSET) * 1000);
  let y = local.getUTCFullYear();
  let m = local.getUTCMonth();
  if (local.getUTCDate() < resetDay) m -= 1;
  const start = Date.UTC(y, m, resetDay) / 1000 - TZ_OFFSET;
  if (m === 11) {
    y += 1;
    m = -1;
  }
  return [start, Date.UTC(y, m + 1, resetDay) / 1000 - TZ_OFFSET];
}

function quotas(ctx: Ctx) {
  return {
    quotas: rules(ctx.state)
      .filter((s) => s['.type'] === 'quota' && s.enabled !== '0')
      .map((s) => {
        const i = ctx.state.devices.findIndex((d) => d.mac === String(s.mac).toUpperCase());
        const [start, end] = periodOf(ctx.now, String(s.period ?? 'month'), Number(s.reset_day ?? 1));
        const bytes = i >= 0 ? (bytesFor(ctx, i, 'internet', start, ctx.now) ?? [0, 0]) : [0, 0];
        const used = s.direction === 'download' ? bytes[0] : bytes[0] + bytes[1];
        const limit = Number(s.limit_mb ?? 0) * 1024 * 1024;
        const pct = limit ? Math.round((used / limit) * 1000) / 10 : 0;
        const allowUntil = ctx.state.control.allowed[s['.name']] ?? 0;
        const state = allowUntil > ctx.now ? 'allowed' : pct >= 100 ? 'exceeded' : pct >= 80 ? 'warned' : 'ok';
        return {
          section: s['.name'],
          mac: String(s.mac).toUpperCase(),
          period: s.period ?? 'month',
          period_start: start,
          period_end: end,
          limit,
          used: Math.round(used),
          pct,
          state,
          allow_until: allowUntil > ctx.now ? allowUntil : 0,
          action: s.action === 'limit' ? 'limit' : 'block',
        };
      }),
  };
}

function quotaAllow(ctx: Ctx, p: Record<string, unknown>) {
  const s = ctx.state.uci.routelink?.[String(p.section)];
  if (!s || s['.type'] !== 'quota') throw new UbusError('NOT_FOUND', 'routelink');
  if (p.until !== 'hour' && p.until !== 'period') throw invalid();
  const [, end] = periodOf(ctx.now, String(s.period ?? 'month'), Number(s.reset_day ?? 1));
  ctx.state.control.allowed[s['.name']] = p.until === 'hour' ? ctx.now + HOUR : end;
  return {};
}

const dnsOn = (s: DemoState) => s.uci.routelink?.dns?.enabled === '1';

/** Popular destinations by kind of device: host, share of its traffic, connections. */
const SITES: Record<string, [string, number][]> = {
  video: [
    ['v16-webapp.tiktok.com', 0.3],
    ['upos-sz-mirrorcos.bilivideo.com', 0.25],
    ['vod.iqiyi.com', 0.15],
    ['rr3---sn-i3b7knld.googlevideo.com', 0.12],
    ['ipv4-c001.1.nflxvideo.net', 0.1],
  ],
  phone: [
    ['wx.qq.com', 0.2],
    ['api.weibo.cn', 0.12],
    ['img.alicdn.com', 0.12],
    ['p3-pc.douyinpic.com', 0.15],
    ['gateway.icloud.com', 0.08],
    ['www.baidu.com', 0.05],
  ],
  computer: [
    ['github.com', 0.12],
    ['objects.githubusercontent.com', 0.2],
    ['registry.npmjs.org', 0.15],
    ['www.bilibili.com', 0.1],
    ['update.code.visualstudio.com', 0.08],
    ['outlook.office365.com', 0.06],
  ],
  iot: [
    ['iot-api.example-camera.com', 0.6],
    ['ntp.aliyun.com', 0.05],
    ['device-metrics-us.amazon.com', 0.3],
  ],
};

const kindOf = (d: DemoDevice) =>
  /TV|Switch|Sonos/.test(d.hostname)
    ? 'video'
    : /iPhone|Pixel|Galaxy|iPad/.test(d.hostname)
      ? 'phone'
      : /Camera|Echo|Plug|LaserJet/.test(d.hostname)
        ? 'iot'
        : 'computer';

const fakeIp = (host: string) => {
  const h = [...host].reduce((s, c) => (s * 33 + c.charCodeAt(0)) >>> 0, 5381);
  return `${(h % 200) + 20}.${(h >>> 8) % 256}.${(h >>> 16) % 256}.${((h >>> 24) % 250) + 1}`;
};

function destinations(ctx: Ctx, p: Record<string, unknown>) {
  if (!dnsOn(ctx.state)) return { destinations: [] };
  const i = deviceIndex(ctx.state, p.mac);
  const start = num(p.start);
  const end = num(p.end);
  if (start === undefined || end === undefined || start >= end) throw invalid();
  const limit = num(p.limit) ?? 100;
  const [rx, tx] = bytesFor(ctx, i, 'internet', start, end) ?? [0, 0];
  const sites = SITES[kindOf(ctx.state.devices[i])];
  const rest = 1 - sites.reduce((s, [, share]) => s + share, 0);
  const list = [
    ...sites.map(([host, share], k) => ({ host, share, conns: 2 + Math.floor(hash01(i, k, 113) * 30) })),
    { host: undefined, share: rest, conns: 4 },
  ];
  return {
    destinations: list
      .filter((d) => d.share > 0)
      .map((d) => ({
        ...(d.host ? { host: d.host } : {}),
        ip: d.host ? fakeIp(d.host) : '203.0.113.200',
        rx: Math.round(rx * d.share),
        tx: Math.round(tx * d.share),
        conns: d.conns,
      }))
      .sort((a, b) => b.rx + b.tx - (a.rx + a.tx))
      .slice(0, limit),
  };
}

const DNS_STEP = 5 * MINUTE;

function dnsLog(ctx: Ctx, p: Record<string, unknown>) {
  if (!dnsOn(ctx.state)) return { count: 0, records: [] };
  const start = Math.max(num(p.start) ?? 0, ctx.now - 7 * DAY);
  const end = Math.min(num(p.end) ?? ctx.now, ctx.now);
  const limit = num(p.limit) ?? 100;
  const offset = num(p.offset) ?? 0;
  if (start >= end || limit < 1 || limit > 1000 || offset < 0) throw invalid();
  const only = p.mac === undefined ? undefined : deviceIndex(ctx.state, p.mac);
  const q = typeof p.q === 'string' ? p.q.toLowerCase() : '';
  const records: { ts: number; mac: string; name: string; type: string; rcode: string; answers: string[] }[] = [];
  for (let t = Math.floor(end / DNS_STEP) * DNS_STEP; t >= start; t -= DNS_STEP) {
    ctx.state.devices.forEach((d, i) => {
      if ((only !== undefined && i !== only) || !present(ctx, i, t) || hash01(i, t, 127) > 0.6) return;
      const sites = SITES[kindOf(d)];
      const k = Math.floor(hash01(i, t, 131) * sites.length);
      const name = sites[k][0];
      if (q && !name.includes(q)) return;
      const aaaa = hash01(i, t, 137) < 0.3;
      records.push({
        ts: t + Math.floor(hash01(i, t, 139) * DNS_STEP),
        mac: d.mac,
        name,
        type: aaaa ? 'AAAA' : 'A',
        rcode: 'NOERROR',
        answers: aaaa ? [] : [fakeIp(name)],
      });
    });
  }
  records.sort((a, b) => b.ts - a.ts);
  return { count: records.length, records: records.slice(offset, offset + limit) };
}

function notifyTest(ctx: Ctx, p: Record<string, unknown>) {
  const s = ctx.state.uci.routelink?.[String(p.section)];
  if (!s || s['.type'] !== 'notify') throw new UbusError('NOT_FOUND', 'routelink');
  // A webhook pointing at an obviously wrong address fails like it would on the router.
  if (/fail|invalid|example\.com/.test(String(s.url ?? ''))) {
    const error = 'HTTP 404';
    ctx.state.control.lastError[s['.name']] = { error, ts: ctx.now };
    return { ok: false, error };
  }
  ctx.state.control.lastOk[s['.name']] = ctx.now;
  return { ok: true };
}

function notifyStatus(ctx: Ctx) {
  return {
    pending: 0,
    channels: rules(ctx.state)
      .filter((s) => s['.type'] === 'notify')
      .map((s) => ({
        section: s['.name'],
        last_ok: ctx.state.control.lastOk[s['.name']] ?? ctx.now - 2 * HOUR,
        last_error: ctx.state.control.lastError[s['.name']]?.error ?? '',
        last_error_ts: ctx.state.control.lastError[s['.name']]?.ts ?? 0,
      })),
  };
}

type Handler = (state: DemoState, params: Record<string, unknown>, now: number) => unknown;
const installed =
  (fn: (ctx: Ctx, p: Record<string, unknown>) => unknown): Handler =>
  (s, p, nowMs) => {
    if (!s.agent.installed) throw new UbusError('PERMISSION_DENIED', 'routelink');
    return fn({ state: s, now: Math.floor(nowMs / 1000) }, p);
  };

export const controlAgentHandlers: Record<string, Handler> = {
  'routelink.quotas': installed(quotas),
  'routelink.quota_allow': installed(quotaAllow),
  'routelink.destinations': installed(destinations),
  'routelink.dns': installed(dnsLog),
  'routelink.notify_test': installed(notifyTest),
  'routelink.notify_status': installed(notifyStatus),
};

export const demoDnsEnabled = dnsOn;
