import type { AppLanguage } from '@/i18n';
import { formatClock, formatMonth, formatNumericDay } from '@/utils/dates';

export interface Tick {
  /** Epoch seconds. */
  t: number;
  label: string;
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
/** Seconds between ticks, finest first; 'month' steps by calendar month. */
const STEPS: (number | 'month')[] = [
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  'month',
];

const localMidnight = (t: number) => {
  const d = new Date(t * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

/** Tick positions at round local times (phone time zone), at least `minSpacing` pixels apart. */
export function timeTicks(start: number, end: number, width: number, lang: AppLanguage, minSpacing = 64): Tick[] {
  const span = end - start;
  if (width <= 0 || span <= 0) return [];
  const maxTicks = Math.max(1, Math.floor(width / minSpacing));
  const step = STEPS.find((s) => (s === 'month' ? span / (30 * DAY) : span / s) <= maxTicks) ?? 'month';

  const times: number[] = [];
  if (step === 'month') {
    const d = new Date(start * 1000);
    const months = Math.max(1, Math.ceil(span / (30 * DAY) / maxTicks));
    for (let m = d.getMonth() + 1; ; m += months) {
      const t = Math.floor(new Date(d.getFullYear(), m, 1).getTime() / 1000);
      if (t > end) break;
      times.push(t);
    }
  } else if (step >= DAY) {
    const days = step / DAY;
    for (let t = localMidnight(start + DAY - 1); t <= end;) {
      times.push(t);
      const d = new Date(t * 1000);
      d.setDate(d.getDate() + days);
      t = Math.floor(d.getTime() / 1000);
    }
  } else {
    // Clock times: steps counted from local midnight, so 3-hour ticks land on 00, 03, 06...
    const base = localMidnight(start);
    for (let t = base + Math.ceil((start - base) / step) * step; t <= end; t += step) times.push(t);
  }

  const label = (t: number) =>
    step === 'month' ? formatMonth(t, lang) : step >= DAY ? formatNumericDay(t) : formatClock(t);
  return times.map((t) => ({ t, label: label(t) }));
}

/** Consecutive runs of present and missing points, so charts break their lines at gaps. */
export function runs(points: readonly { rx: number | null }[]): { from: number; to: number; missing: boolean }[] {
  const out: { from: number; to: number; missing: boolean }[] = [];
  points.forEach((p, i) => {
    const missing = p.rx === null;
    const last = out[out.length - 1];
    if (last && last.missing === missing) last.to = i;
    else out.push({ from: i, to: i, missing });
  });
  return out;
}
