import { normalizeMac } from '@/utils/mac';

import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type UciSection, type UciValues } from '../uci';
import type { UbusCall } from '../ubus/types';

/**
 * The plugin's rules in UCI `routelink` (P4, plan §1.1): per-device speed limits and quotas, DNS logging
 * and push channels. The app edits the config and applies it without rollback (design §7.2); the daemon
 * reloads on the config change.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface LimitRule {
  section?: string;
  mac: string;
  enabled: boolean;
  /** kbit/s, 0 = no limit */
  download: number;
  upload: number;
  /** Empty = every day */
  weekdays: Weekday[];
  /** "HH:MM"; both unset = all day */
  start?: string;
  stop?: string;
}

export type QuotaPeriod = 'day' | 'week' | 'month';

export interface QuotaRule {
  section?: string;
  mac: string;
  enabled: boolean;
  period: QuotaPeriod;
  /** month: 1–28; week: 1–7 (Monday = 1); unused for day */
  resetDay: number;
  limitMb: number;
  direction: 'total' | 'download';
  action: 'block' | 'limit';
  /** kbit/s when action = limit */
  limitDownload?: number;
  limitUpload?: number;
}

export interface DnsSettings {
  enabled: boolean;
  keepDays: number;
  maxRecords: number;
}

export const NOTIFY_TYPES = [
  'webhook',
  'bark',
  'serverchan',
  'pushplus',
  'telegram',
  'wecom',
  'dingtalk',
  'feishu',
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

export const NOTIFY_EVENTS = ['device_new', 'device_watch', 'quota', 'outage'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface NotifyChannel {
  section?: string;
  type: NotifyType;
  enabled: boolean;
  name: string;
  url: string;
  template: string;
  token: string;
  chatId: string;
  secret: string;
  events: NotifyEvent[];
}

export type NotifyLang = 'auto' | 'zh_cn' | 'en';

export interface AgentRules {
  limits: LimitRule[];
  quotas: QuotaRule[];
  dns: DnsSettings;
  channels: NotifyChannel[];
  lang: NotifyLang;
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const int = (v: unknown, d = 0) => {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : d;
};
const flag = (v: unknown, d = false) => (v === undefined ? d : v === '1' || v === 'true' || v === 'on' || v === 'yes');
const listOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/\s+/) : [];
const time = (v: unknown) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, '0') : undefined);

const ofType = (values: Record<string, UciSection>, type: string) =>
  Object.values(values)
    .filter((s) => s['.type'] === type)
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0));

export const DEFAULT_DNS: DnsSettings = { enabled: false, keepDays: 7, maxRecords: 100_000 };

export function parseRules(values: Record<string, UciSection>): AgentRules {
  const dnsSection = values.dns;
  const notify = values.notify;
  return {
    limits: ofType(values, 'limit').map((s) => ({
      section: s['.name'],
      mac: normalizeMac(str(s.mac)) ?? str(s.mac),
      enabled: flag(s.enabled, true),
      download: int(s.download),
      upload: int(s.upload),
      weekdays: listOf(s.weekdays).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d)),
      start: time(s.start_time),
      stop: time(s.stop_time),
    })),
    quotas: ofType(values, 'quota').map((s) => ({
      section: s['.name'],
      mac: normalizeMac(str(s.mac)) ?? str(s.mac),
      enabled: flag(s.enabled, true),
      period: (['day', 'week', 'month'] as const).find((p) => p === s.period) ?? 'month',
      resetDay: int(s.reset_day, 1),
      limitMb: int(s.limit_mb),
      direction: s.direction === 'download' ? 'download' : 'total',
      action: s.action === 'limit' ? 'limit' : 'block',
      limitDownload: s.limit_download === undefined ? undefined : int(s.limit_download),
      limitUpload: s.limit_upload === undefined ? undefined : int(s.limit_upload),
    })),
    dns: dnsSection
      ? {
          enabled: flag(dnsSection.enabled),
          keepDays: int(dnsSection.keep_days, DEFAULT_DNS.keepDays),
          maxRecords: int(dnsSection.max_records, DEFAULT_DNS.maxRecords),
        }
      : DEFAULT_DNS,
    channels: ofType(values, 'notify').map((s) => ({
      section: s['.name'],
      type: (NOTIFY_TYPES as readonly string[]).includes(str(s.type)) ? (s.type as NotifyType) : 'webhook',
      enabled: flag(s.enabled, true),
      name: str(s.name),
      url: str(s.url),
      template: str(s.template),
      token: str(s.token),
      chatId: str(s.chat_id),
      secret: str(s.secret),
      events: listOf(s.events).filter((e): e is NotifyEvent => (NOTIFY_EVENTS as readonly string[]).includes(e)),
    })),
    lang:
      notify && (['auto', 'zh_cn', 'en'] as const).includes(notify.lang as NotifyLang)
        ? (notify.lang as NotifyLang)
        : 'auto',
  };
}

export async function getRules(conn: RouterConnection): Promise<AgentRules> {
  return parseRules(await uci.get(conn, 'routelink'));
}

// ---- validation ----

export type RuleIssue =
  | 'mac'
  | 'rate'
  | 'time'
  | 'weekdays'
  | 'reset-day'
  | 'limit-mb'
  | 'limit-rate'
  | 'url'
  | 'token'
  | 'chat-id'
  | 'events';

const validTime = (t?: string) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function validateLimit(r: LimitRule): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (!normalizeMac(r.mac)) issues.push('mac');
  if (r.download < 0 || r.upload < 0 || (r.download === 0 && r.upload === 0)) issues.push('rate');
  if (!validTime(r.start) || !validTime(r.stop) || !!r.start !== !!r.stop || (r.start && r.start === r.stop))
    issues.push('time');
  return issues;
}

export function validateQuota(q: QuotaRule): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (!normalizeMac(q.mac)) issues.push('mac');
  if (!(q.limitMb > 0)) issues.push('limit-mb');
  if (q.period === 'month' && (q.resetDay < 1 || q.resetDay > 28)) issues.push('reset-day');
  if (q.period === 'week' && (q.resetDay < 1 || q.resetDay > 7)) issues.push('reset-day');
  if (q.action === 'limit' && !((q.limitDownload ?? 0) > 0 || (q.limitUpload ?? 0) > 0)) issues.push('limit-rate');
  return issues;
}

const isUrl = (s: string) => /^https?:\/\/[^\s/]+/i.test(s.trim());

/** What each channel needs (design §11's table). */
export function validateChannel(c: NotifyChannel): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const needsUrl = ['webhook', 'bark', 'wecom', 'dingtalk', 'feishu'].includes(c.type);
  if (needsUrl && !isUrl(c.url)) issues.push('url');
  if (['bark', 'serverchan', 'pushplus', 'telegram'].includes(c.type) && !c.token.trim()) issues.push('token');
  if (c.type === 'telegram' && !/^-?\d+$|^@\w+$/.test(c.chatId.trim())) issues.push('chat-id');
  if (!c.events.length) issues.push('events');
  return issues;
}

// ---- changes ----

const limitValues = (r: LimitRule): UciValues => ({
  mac: normalizeMac(r.mac) ?? r.mac,
  enabled: r.enabled ? '1' : '0',
  download: String(Math.round(r.download)),
  upload: String(Math.round(r.upload)),
});

/** uci calls saving one limit rule (new when it has no section). */
export function limitChanges(r: LimitRule): UbusCall[] {
  const values = limitValues(r);
  const optional: [string, string | string[] | undefined][] = [
    ['weekdays', r.weekdays.length && r.weekdays.length < 7 ? [...r.weekdays] : undefined],
    ['start_time', r.start],
    ['stop_time', r.stop],
  ];
  for (const [k, v] of optional) if (v !== undefined) values[k] = v;
  if (!r.section) return [uci.add('routelink', 'limit', values)];
  return [
    uci.set('routelink', r.section, values),
    ...optional.filter(([, v]) => v === undefined).map(([k]) => uci.delOption('routelink', r.section!, k)),
  ];
}

export function quotaChanges(q: QuotaRule): UbusCall[] {
  const values: UciValues = {
    mac: normalizeMac(q.mac) ?? q.mac,
    enabled: q.enabled ? '1' : '0',
    period: q.period,
    reset_day: String(q.period === 'day' ? 1 : q.resetDay),
    limit_mb: String(Math.round(q.limitMb)),
    direction: q.direction,
    action: q.action,
  };
  const rates: [string, number | undefined][] = [
    ['limit_download', q.action === 'limit' ? q.limitDownload : undefined],
    ['limit_upload', q.action === 'limit' ? q.limitUpload : undefined],
  ];
  for (const [k, v] of rates) if (v !== undefined) values[k] = String(Math.round(v));
  if (!q.section) return [uci.add('routelink', 'quota', values)];
  return [
    uci.set('routelink', q.section, values),
    ...rates.filter(([, v]) => v === undefined).map(([k]) => uci.delOption('routelink', q.section!, k)),
  ];
}

/** `dns` is a named section; it may not exist yet on a fresh install of an older config. */
export function dnsChanges(current: Record<string, UciSection>, d: DnsSettings): UbusCall[] {
  const values = { enabled: d.enabled ? '1' : '0', keep_days: String(d.keepDays), max_records: String(d.maxRecords) };
  return current.dns ? [uci.set('routelink', 'dns', values)] : [uci.add('routelink', 'dns', values, 'dns')];
}

export function channelChanges(c: NotifyChannel): UbusCall[] {
  const values: UciValues = {
    type: c.type,
    enabled: c.enabled ? '1' : '0',
    name: c.name.trim(),
    url: c.url.trim(),
    template: c.template,
    token: c.token.trim(),
    chat_id: c.chatId.trim(),
    secret: c.secret.trim(),
    events: [...c.events],
  };
  return c.section ? [uci.set('routelink', c.section, values)] : [uci.add('routelink', 'notify', values)];
}

export function langChanges(current: Record<string, UciSection>, lang: NotifyLang): UbusCall[] {
  return current.notify
    ? [uci.set('routelink', 'notify', { lang })]
    : [uci.add('routelink', 'notify_settings', { lang }, 'notify')];
}

export const deleteRule = (section: string): UbusCall[] => [uci.del('routelink', section)];

/** Stages and applies rule changes; nothing here can cut the phone off, so no rollback (design §7.2). */
export async function applyRules(conn: RouterConnection, changes: UbusCall[]): Promise<void> {
  if (changes.length) await stageAndApply(conn, changes, { mode: 'direct' });
}

/** Rules of one device. */
export const rulesOf = (rules: AgentRules, mac: string) => {
  const m = normalizeMac(mac) ?? mac;
  return { limit: rules.limits.find((r) => r.mac === m), quota: rules.quotas.find((q) => q.mac === m) };
};

/**
 * The plugin itself pushes new devices (an enabled channel subscribed to `device_new`): the app's own
 * background notice for them would only repeat it (plan P4 §0.7). False when the plugin is not there.
 */
export async function pluginPushesNewDevices(conn: RouterConnection): Promise<boolean> {
  const [info, config] = await conn.batch([
    { object: 'routelink', method: 'info' },
    { object: 'uci', method: 'get', params: { config: 'routelink' } },
  ]);
  if (!info.ok || !config.ok) return false;
  const modules = (info.data as { modules?: unknown }).modules;
  if (!Array.isArray(modules) || !modules.includes('notify')) return false;
  const values = (config.data as { values?: Record<string, UciSection> }).values ?? {};
  return parseRules(values).channels.some((c) => c.enabled && c.events.includes('device_new'));
}
