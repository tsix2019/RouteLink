import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciSection, type UciValues } from '../uci';
import type { UbusCall } from '../ubus/types';
import {
  activeWindow,
  ALL_DAYS,
  cronDays,
  minutesOf,
  nextDay,
  sortDays,
  TIME_RE,
  type WeeklyWindow,
  type Weekday,
} from '@/utils/weekly';

import { MANAGED_MARK, readCrontab, writeCrontab, type CronLine, type Crontab } from './cron';

/** DV-8: one firewall rule per blocked period (two across midnight), named after the device and the period. */
export const SCHEDULE_RULE_PREFIX = 'RouteLink: schedule ';
const CRON_MARK = `${MANAGED_MARK} schedule `;

export type { Weekday };
/** HH:MM in router time; `to` earlier than `from` ends the next morning. */
export type BlockPeriod = WeeklyWindow;

export interface ParentalSchedule {
  mac: string;
  enabled: boolean;
  periods: BlockPeriod[];
  /** Firewall sections that belong to this device. */
  sections: string[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const RULE_NAME = /^RouteLink: schedule ([0-9A-F:]{17}) (\d\d:\d\d)-(\d\d:\d\d)$/;

export function validatePeriod(p: BlockPeriod): 'days' | 'time' | 'same' | null {
  if (!p.days.length) return 'days';
  if (!TIME_RE.test(p.from) || !TIME_RE.test(p.to)) return 'time';
  return p.from === p.to ? 'same' : null;
}

/** Periods with the same times are one period on the union of their days. */
function normalize(periods: BlockPeriod[]): BlockPeriod[] {
  const byTime = new Map<string, BlockPeriod>();
  for (const p of periods) {
    const key = `${p.from}-${p.to}`;
    const seen = byTime.get(key);
    byTime.set(key, { from: p.from, to: p.to, days: sortDays([...(seen?.days ?? []), ...p.days]) });
  }
  return [...byTime.values()].sort((a, b) => minutesOf(a.from) - minutesOf(b.from) || a.days[0] - b.days[0]);
}

function parseWeekdays(v: unknown): Weekday[] {
  const text = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
  if (!text.trim()) return [...ALL_DAYS];
  const days = text
    .split(/\s+/)
    .map((w) => DAY_NAMES.findIndex((n) => n.toLowerCase() === w.slice(0, 3).toLowerCase()))
    .filter((i): i is Weekday => i >= 0);
  return sortDays(days);
}

export function parseSchedules(values: Record<string, UciSection>): Map<string, ParentalSchedule> {
  const out = new Map<string, ParentalSchedule & { parts: Map<string, BlockPeriod> }>();
  const rules = Object.values(values)
    .filter((s) => s['.type'] === 'rule')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0));
  for (const s of rules) {
    const m = RULE_NAME.exec(String(s.name ?? ''));
    if (!m) continue;
    const [, mac, from, to] = m;
    let schedule = out.get(mac);
    if (!schedule) {
      schedule = { mac, enabled: true, periods: [], sections: [], parts: new Map() };
      out.set(mac, schedule);
    }
    schedule.sections.push(s['.name']);
    if (s.enabled === '0') schedule.enabled = false;
    // The evening part carries the days; the morning part after midnight only repeats them, shifted.
    const key = `${from}-${to}`;
    const period = schedule.parts.get(key) ?? { from, to, days: [] };
    const morning = from > to && String(s.start_time ?? '').startsWith('00:00');
    if (!morning) period.days = sortDays([...period.days, ...parseWeekdays(s.weekdays)]);
    schedule.parts.set(key, period);
  }
  return new Map(
    [...out].map(([mac, { parts, ...schedule }]) => [
      mac,
      { ...schedule, periods: normalize([...parts.values()].filter((p) => p.days.length)) },
    ]),
  );
}

function ruleValues(mac: string, label: string, start: string, stop: string, days: Weekday[], enabled: boolean) {
  const values: UciValues = {
    name: `${SCHEDULE_RULE_PREFIX}${mac} ${label}`,
    src: '*',
    dest: '*',
    src_mac: [mac],
    proto: 'all',
    target: 'REJECT',
    start_time: start,
    stop_time: stop,
  };
  if (days.length < 7)
    values.weekdays = sortDays(days)
      .map((d) => DAY_NAMES[d])
      .join(' ');
  if (!enabled) values.enabled = '0';
  return values;
}

/** Replaces the device's rules with `periods`; an empty list removes the schedule. */
export function scheduleChanges(
  mac: string,
  periods: BlockPeriod[],
  enabled: boolean,
  existing?: ParentalSchedule,
): UbusCall[] {
  const changes = (existing?.sections ?? []).map((s) => uci.del('firewall', s));
  for (const p of normalize(periods)) {
    const label = `${p.from}-${p.to}`;
    if (p.from < p.to) {
      changes.push(uci.add('firewall', 'rule', ruleValues(mac, label, `${p.from}:00`, `${p.to}:00`, p.days, enabled)));
      continue;
    }
    // Across midnight: the evening on the chosen days, the morning on the days after them.
    changes.push(uci.add('firewall', 'rule', ruleValues(mac, label, `${p.from}:00`, '23:59:59', p.days, enabled)));
    if (p.to !== '00:00') {
      const mornings = p.days.map(nextDay);
      changes.push(uci.add('firewall', 'rule', ruleValues(mac, label, '00:00:00', `${p.to}:00`, mornings, enabled)));
    }
  }
  return changes;
}

/** The period blocking now (router time), or null. */
export const activePeriod = (periods: BlockPeriod[], weekday: number, minute: number) =>
  activeWindow(periods, weekday, minute);

/**
 * fw4 accepts established connections before any rule, so the rules alone would not stop a running video:
 * at the start of each period this drops the device's tracked connections (OpenWrt's kernel takes an
 * address written to /proc/net/nf_conntrack).
 */
export function flushCommand(mac: string): string {
  const lower = mac.toLowerCase();
  return `for a in $(ip neigh show | awk 'tolower($5)=="${lower}"{print $1}'); do echo $a > /proc/net/nf_conntrack; done 2>/dev/null`;
}

/** The crontab with this device's flush entries replaced; null removes them. */
export function scheduleCron(lines: CronLine[], mac: string, periods: BlockPeriod[] | null): CronLine[] {
  const mark = `${CRON_MARK}${mac}`;
  const kept: CronLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'other' && line.text === mark) {
      if (lines[i + 1]?.kind === 'entry') i++;
      continue;
    }
    kept.push(line);
  }
  for (const p of normalize(periods ?? [])) {
    kept.push({ kind: 'other', text: mark });
    kept.push({
      kind: 'entry',
      schedule: [String(Number(p.from.slice(3))), String(Number(p.from.slice(0, 2))), '*', '*', cronDays(p.days)],
      command: flushCommand(mac),
      managed: true,
    });
  }
  return kept;
}

export interface ParentalState {
  schedules: Map<string, ParentalSchedule>;
  crontab: Crontab;
}

export async function getParental(conn: RouterConnection): Promise<ParentalState> {
  const [firewall, crontab] = await Promise.all([uci.get(conn, 'firewall'), readCrontab(conn)]);
  return { schedules: parseSchedules(firewall), crontab };
}

type Tuning = Omit<ApplyOptions, 'mode'>;

/**
 * Rules first (with rollback: a wrong MAC could cut off the phone), then the crontab. The crontab is only
 * touched once the rules are confirmed, so a rolled-back change leaves both as they were.
 */
export async function saveSchedule(
  conn: RouterConnection,
  mac: string,
  periods: BlockPeriod[],
  enabled: boolean,
  t?: Tuning,
): Promise<ApplyOutcome> {
  const schedules = parseSchedules(await uci.get(conn, 'firewall'));
  const changes = scheduleChanges(mac, periods, enabled, schedules.get(mac));
  const outcome = changes.length ? await stageAndApply(conn, changes, { mode: 'rollback', ...t }) : null;
  if (outcome?.status === 'rolled-back') return outcome;
  const crontab = await readCrontab(conn);
  const lines = scheduleCron(crontab.lines, mac, enabled && periods.length ? periods : null);
  await writeCrontab(conn, lines, crontab.original);
  return outcome ?? { status: 'applied' };
}
