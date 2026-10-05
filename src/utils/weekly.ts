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
