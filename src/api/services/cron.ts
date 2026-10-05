import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import { ActionError } from './action-error';

export const CRONTAB = '/etc/crontabs/root';
/** Entries the app manages (Wi-Fi schedules, M3) carry this comment on the line before. */
export const MANAGED_MARK = '# RouteLink:';

export interface CronEntry {
  kind: 'entry';
  /** minute, hour, day of month, month, day of week */
  schedule: [string, string, string, string, string];
  command: string;
  /** Preceded by a "# RouteLink:" comment. */
  managed: boolean;
}
export interface CronOther {
  kind: 'other';
  text: string;
}
export type CronLine = CronEntry | CronOther;

const ENTRY = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/;

/** Comments, blank lines and anything unusual are kept verbatim so writing back changes nothing else. */
export function parseCrontab(text: string): CronLine[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const out: CronLine[] = [];
  for (const line of lines) {
    const m = ENTRY.exec(line);
    const schedule = m ? (m.slice(1, 6) as CronEntry['schedule']) : null;
    if (m && schedule && !line.trimStart().startsWith('#') && validateSchedule(schedule) === null) {
      const prev = out[out.length - 1];
      out.push({ kind: 'entry', schedule, command: m[6], managed: prev?.kind === 'other' && prev.text.startsWith(MANAGED_MARK) });
    } else {
      out.push({ kind: 'other', text: line });
    }
  }
  return out;
}

export function serializeCrontab(lines: CronLine[]): string {
  if (!lines.length) return '';
  return `${lines.map((l) => (l.kind === 'entry' ? `${l.schedule.join(' ')} ${l.command}` : l.text)).join('\n')}\n`;
}

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { name: 'weekday', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
] as const;

export type ScheduleError = 'fields' | (typeof FIELDS)[number]['name'];

function valueOf(token: string, f: (typeof FIELDS)[number]): number | null {
  const names: readonly string[] | undefined = 'names' in f ? f.names : undefined;
  const named = names?.indexOf(token.toLowerCase()) ?? -1;
  if (named >= 0) return f.name === 'month' ? named + 1 : named;
  if (!/^\d+$/.test(token)) return null;
  const n = Number(token);
  return n >= f.min && n <= f.max ? n : null;
}

function fieldOk(field: string, f: (typeof FIELDS)[number]): boolean {
  return field.split(',').every((part) => {
    const [range, step] = part.split('/');
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) === 0)) return false;
    if (range === '*') return true;
    const [a, b] = range.split('-');
    const lo = valueOf(a, f);
    if (lo === null) return false;
    if (b === undefined) return step === undefined;
    const hi = valueOf(b, f);
    return hi !== null && hi >= lo;
  });
}

/** null when busybox crond accepts the five fields; otherwise the first bad one. */
export function validateSchedule(schedule: readonly string[]): ScheduleError | null {
  if (schedule.length !== 5) return 'fields';
  for (const [i, f] of FIELDS.entries()) if (!fieldOk(schedule[i], f)) return f.name;
  return null;
}

const WEEKDAYS = {
  'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  en: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'],
} as const;

/** Plain words for the common shapes; null for anything else (the screen then shows the fields). */
export function describeSchedule(s: readonly string[], lang: 'zh-CN' | 'en'): string | null {
  const [min, hour, day, month, weekday] = s;
  const zh = lang === 'zh-CN';
  const every = /^\*\/(\d+)$/.exec(min);
  if (every && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return zh ? `每 ${every[1]} 分钟` : `Every ${every[1]} minutes`;
  }
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || month !== '*') return null;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (day === '*' && weekday === '*') return zh ? `每天 ${time}` : `Every day at ${time}`;
  if (day === '*' && /^[0-7]$/.test(weekday)) {
    const d = WEEKDAYS[lang][Number(weekday)];
    return zh ? `每${d} ${time}` : `${d} at ${time}`;
  }
  if (day === '*' && weekday === '1-5') return zh ? `周一至周五 ${time}` : `Weekdays at ${time}`;
  if (/^\d+$/.test(day) && weekday === '*') return zh ? `每月 ${day} 日 ${time}` : `Day ${day} of each month at ${time}`;
  return null;
}

export interface Crontab {
  lines: CronLine[];
  /** File content as read, to detect changes made elsewhere before writing back. */
  original: string;
}

export async function readCrontab(conn: RouterConnection): Promise<Crontab> {
  try {
    const r = await conn.call<{ data?: string }>('file', 'read', { path: CRONTAB });
    const original = r.data ?? '';
    return { lines: parseCrontab(original), original };
  } catch (error) {
    if (error instanceof UbusError && error.code === 'NOT_FOUND') return { lines: [], original: '' };
    throw error;
  }
}

/** Writes the file (no uci staging for crontabs: refuses if someone changed it meanwhile) and reloads cron. */
export async function writeCrontab(conn: RouterConnection, lines: CronLine[], original: string): Promise<void> {
  const current = await readCrontab(conn);
  if (current.original !== original) throw new ActionError('cron-changed');
  await conn.call('file', 'write', { path: CRONTAB, data: serializeCrontab(lines) });
  const r = await conn.call<{ code?: number; stderr?: string }>('file', 'exec', { command: '/etc/init.d/cron', params: ['reload'] });
  if (r.code !== 0) throw new ActionError('cron-reload', r.stderr);
}
