import type { AppLanguage, AppT } from '@/i18n';

export type PresetId = 'lastHour' | 'today' | 'yesterday' | 'last7d' | 'thisMonth' | 'lastMonth' | 'last30d';
export const PRESETS: readonly PresetId[] = [
  'lastHour',
  'today',
  'yesterday',
  'last7d',
  'thisMonth',
  'lastMonth',
  'last30d',
];

/** Whole hours 0–23, `to` exclusive; from > to crosses midnight (22 → 6), from = to is the whole day. */
export interface HourWindow {
  from: number;
  to: number;
}

export type TimeRange =
  | { kind: 'preset'; id: PresetId; hours?: HourWindow }
  /** Epoch seconds. */
  | { kind: 'custom'; start: number; end: number; hours?: HourWindow };

export const DEFAULT_RANGE: TimeRange = { kind: 'preset', id: 'today' };

/** The plugin refuses longer queries. */
const MAX_SPAN_SEC = 3653 * 86_400;

const toSec = (d: Date) => Math.floor(d.getTime() / 1000);

/** Local midnight of `d` shifted by `days` (calendar days: 23- and 25-hour days come out right). */
function midnight(d: Date, days = 0): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  m.setHours(0, 0, 0, 0);
  return m;
}

const monthStart = (d: Date, months = 0) => new Date(d.getFullYear(), d.getMonth() + months, 1);

/** Epoch seconds in the phone's time zone; the end is now or the end of the period, whichever is earlier. */
export function resolveRange(r: TimeRange, now: Date): { start: number; end: number } {
  const nowSec = toSec(now);
  if (r.kind === 'custom') return { start: r.start, end: Math.min(r.end, nowSec) };
  switch (r.id) {
    case 'lastHour':
      return { start: nowSec - 3600, end: nowSec };
    case 'today':
      return { start: toSec(midnight(now)), end: nowSec };
    case 'yesterday':
      return { start: toSec(midnight(now, -1)), end: toSec(midnight(now)) };
    case 'last7d':
      return { start: nowSec - 7 * 86_400, end: nowSec };
    case 'thisMonth':
      return { start: toSec(monthStart(now)), end: nowSec };
    case 'lastMonth':
      return { start: toSec(monthStart(now, -1)), end: toSec(monthStart(now)) };
    case 'last30d':
      return { start: nowSec - 30 * 86_400, end: nowSec };
  }
}

/** Bit n = hour n of the day, as the plugin's `hours` parameter expects. */
export function hoursMask(w: HourWindow): number {
  if (w.from === w.to) return 0xffffff;
  let mask = 0;
  for (let h = w.from; h !== w.to; h = (h + 1) % 24) mask |= 1 << h;
  return mask;
}

export function validateCustom(start: number, end: number, now: number): 'ok' | 'empty' | 'future' | 'too-long' {
  if (end <= start) return 'empty';
  if (start > now) return 'future';
  if (end - start > MAX_SPAN_SEC) return 'too-long';
  return 'ok';
}

const clock = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

/** "Oct 5, 00:00 – 13:47 · daily 20:00–23:00" / "10月5日 00:00 – 13:47 · 每天 20–23 点". */
export function rangeLabel(t: AppT, r: TimeRange, lang: AppLanguage, now = new Date()): string {
  const { start, end } = resolveRange(r, now);
  const a = new Date(start * 1000);
  const b = new Date(end * 1000);
  const withYear = a.getFullYear() !== now.getFullYear() || b.getFullYear() !== now.getFullYear();
  const dated: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', ...clock };
  if (withYear) dated.year = 'numeric';
  const sameDay = a.toDateString() === b.toDateString();
  const text = `${a.toLocaleString(lang, dated)} – ${b.toLocaleString(lang, sameDay ? clock : dated)}`;
  return r.hours ? `${text} · ${t('traffic:range.hours', { from: r.hours.from, to: r.hours.to })}` : text;
}
