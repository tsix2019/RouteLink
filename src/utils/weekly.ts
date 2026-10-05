/** Weekly time windows shared by parental control (DV-8) and Wi-Fi schedules (WL-7). */

/** 0 = Sunday … 6 = Saturday, as in crontab. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ALL_DAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** A window from `from` to `to` (HH:MM) starting on each of `days`; `to` <= `from` ends the next day. */
export interface WeeklyWindow {
  days: Weekday[];
  from: string;
  to: string;
}

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const sortDays = (days: Iterable<Weekday>): Weekday[] => [...new Set(days)].sort((a, b) => a - b);

export const nextDay = (d: Weekday) => ((d + 1) % 7) as Weekday;

/** crontab's day-of-week field: "*" for every day, otherwise a list. */
export const cronDays = (days: Weekday[]) => (days.length === 7 ? '*' : sortDays(days).join(','));

/** The window that covers `minute` (0–1439) on `weekday`, or null. */
export function activeWindow<T extends WeeklyWindow>(windows: T[], weekday: number, minute: number): T | null {
  const yesterday = ((weekday + 6) % 7) as Weekday;
  return (
    windows.find((w) => {
      const from = minutesOf(w.from);
      const to = minutesOf(w.to);
      if (from < to) return w.days.includes(weekday as Weekday) && minute >= from && minute < to;
      return (w.days.includes(weekday as Weekday) && minute >= from) || (w.days.includes(yesterday) && minute < to);
    }) ?? null
  );
}

const DAY_NAMES = {
  'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
} as const;

/** "每天", "周一至周五", "周末", "周日至周四", "周一、周三" (and the English equivalents). */
export function describeDays(days: readonly Weekday[], lang: 'zh-CN' | 'en'): string {
  const set = sortDays(days);
  const zh = lang === 'zh-CN';
  if (set.length === 7) return zh ? '每天' : 'Every day';
  if (set.join() === '1,2,3,4,5') return zh ? '周一至周五' : 'Weekdays';
  if (set.join() === '0,6') return zh ? '周末' : 'Weekends';
  const names = DAY_NAMES[lang];
  // A run of three or more days, also across the end of the week (Fri–Sun).
  const start = set.find((d) => !set.includes(((d + 6) % 7) as Weekday));
  if (start !== undefined && set.length >= 3) {
    let end = start;
    while (set.includes(nextDay(end)) && nextDay(end) !== start) end = nextDay(end);
    const run = (end - start + 7) % 7;
    if (run + 1 === set.length) return zh ? `${names[start]}至${names[end]}` : `${names[start]}–${names[end]}`;
  }
  const ordered = [...set].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
  return ordered.map((d) => names[d]).join(zh ? '、' : ', ');
}

/** "21:30–07:00 (next day)". */
export function describeWindow(from: string, to: string, lang: 'zh-CN' | 'en'): string {
  const overnight = minutesOf(to) <= minutesOf(from);
  return `${from}–${to}${overnight ? (lang === 'zh-CN' ? '（次日）' : ' (next day)') : ''}`;
}
