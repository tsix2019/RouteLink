import { activeWindow, cronDays, minutesOf, nextDay, sortDays, TIME_RE, type Weekday } from '@/utils/weekly';

import type { RouterConnection } from '../connection/types';
import { MANAGED_MARK, readCrontab, writeCrontab, type CronEntry, type CronLine, type Crontab } from './cron';

/**
 * WL-7: Wi-Fi off and on again at set times, as crontab entries the app manages. `wifi down/up` change the
 * running state only, so the wireless configuration stays untouched (a reboot in an off period brings
 * Wi-Fi back until the next entry runs).
 */
export interface WifiSchedule {
  /** 'all' switches every radio. */
  radios: string[] | 'all';
  /** Days on which Wi-Fi goes off. */
  days: Weekday[];
  /** HH:MM router time. */
  off: string;
  /** HH:MM; not later than `off` means the next morning. */
  on: string;
}

const MARK = `${MANAGED_MARK} wifi-schedule `;
const WIFI = '/sbin/wifi';
const MARK_LINE = /^# RouteLink: wifi-schedule (\d+) (off|on)$/;

export function validateWifiSchedule(s: WifiSchedule): 'days' | 'radios' | 'time' | 'same' | null {
  if (!s.days.length) return 'days';
  if (s.radios !== 'all' && !s.radios.length) return 'radios';
  if (!TIME_RE.test(s.off) || !TIME_RE.test(s.on)) return 'time';
  return s.off === s.on ? 'same' : null;
}

const command = (action: 'down' | 'up', radios: WifiSchedule['radios']) =>
  radios === 'all' ? `${WIFI} ${action}` : radios.map((r) => `${WIFI} ${action} ${r}`).join('; ');

/** The radios a command we wrote switches, or null for a command we did not write. */
function radiosOf(cmd: string, action: 'down' | 'up'): WifiSchedule['radios'] | null {
  if (cmd === `${WIFI} ${action}`) return 'all';
  const parts = cmd.split('; ');
  const prefix = `${WIFI} ${action} `;
  if (!parts.every((p) => p.startsWith(prefix) && /^[\w.-]+$/.test(p.slice(prefix.length)))) return null;
  return parts.map((p) => p.slice(prefix.length));
}

const timeOf = (e: CronEntry) =>
  /^\d+$/.test(e.schedule[0]) && /^\d+$/.test(e.schedule[1])
    ? `${e.schedule[1].padStart(2, '0')}:${e.schedule[0].padStart(2, '0')}`
    : null;

function daysOf(field: string): Weekday[] | null {
  if (field === '*') return [0, 1, 2, 3, 4, 5, 6];
  const days = field.split(',').map(Number);
  return days.every((d) => Number.isInteger(d) && d >= 0 && d <= 7)
    ? sortDays(days.map((d) => (d % 7) as Weekday))
    : null;
}

export function parseWifiSchedules(lines: CronLine[]): WifiSchedule[] {
  const halves = new Map<number, { off?: CronEntry; on?: CronEntry }>();
  lines.forEach((line, i) => {
    const m = line.kind === 'other' ? MARK_LINE.exec(line.text) : null;
    const entry = lines[i + 1];
    if (!m || entry?.kind !== 'entry') return;
    const id = Number(m[1]);
    halves.set(id, { ...halves.get(id), [m[2]]: entry });
  });
  const out: WifiSchedule[] = [];
  for (const id of [...halves.keys()].sort((a, b) => a - b)) {
    const { off, on } = halves.get(id)!;
    if (!off || !on) continue;
    const radios = radiosOf(off.command, 'down');
    const onRadios = radiosOf(on.command, 'up');
    const days = daysOf(off.schedule[4]);
    const [offAt, onAt] = [timeOf(off), timeOf(on)];
    if (!radios || !onRadios || !days || !offAt || !onAt) continue;
    out.push({ radios, days, off: offAt, on: onAt });
  }
  return out;
}

const entry = (time: string, days: Weekday[], cmd: string): CronEntry => ({
  kind: 'entry',
  schedule: [String(Number(time.slice(3))), String(Number(time.slice(0, 2))), '*', '*', cronDays(days)],
  command: cmd,
  managed: true,
});

/** The crontab with all Wi-Fi schedule entries replaced by `schedules`. */
export function wifiScheduleCron(lines: CronLine[], schedules: WifiSchedule[]): CronLine[] {
  const kept: CronLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'other' && MARK_LINE.test(line.text)) {
      if (lines[i + 1]?.kind === 'entry') i++;
      continue;
    }
    kept.push(line);
  }
  schedules.forEach((s, i) => {
    // Wi-Fi comes back the next morning when the on time is not later than the off time.
    const onDays = minutesOf(s.on) > minutesOf(s.off) ? s.days : s.days.map(nextDay);
    kept.push({ kind: 'other', text: `${MARK}${i + 1} off` }, entry(s.off, s.days, command('down', s.radios)));
    kept.push({ kind: 'other', text: `${MARK}${i + 1} on` }, entry(s.on, onDays, command('up', s.radios)));
  });
  return kept;
}

/** Whether a schedule has `radio` switched off at this moment (router time). */
export function wifiOffNow(schedules: WifiSchedule[], radio: string, weekday: number, minute: number): boolean {
  const relevant = schedules
    .filter((s) => s.radios === 'all' || s.radios.includes(radio))
    .map((s) => ({ days: s.days, from: s.off, to: s.on }));
  return activeWindow(relevant, weekday, minute) !== null;
}

export async function getWifiSchedules(
  conn: RouterConnection,
): Promise<{ schedules: WifiSchedule[]; crontab: Crontab }> {
  const crontab = await readCrontab(conn);
  return { schedules: parseWifiSchedules(crontab.lines), crontab };
}

/** Writes the schedules (refused when the crontab changed since `crontab` was read). */
export async function saveWifiSchedules(
  conn: RouterConnection,
  schedules: WifiSchedule[],
  crontab: Crontab,
): Promise<void> {
  await writeCrontab(conn, wifiScheduleCron(crontab.lines, schedules), crontab.original);
}
