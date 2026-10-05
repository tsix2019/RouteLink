import type { HistoryPoint } from '@/api/services/agent';

/**
 * The plugin keeps hourly data for 90 days and daily data for two years, but only picks calendar months
 * for data older than that; days and months for the WAN page are therefore summed on the phone.
 */
function groupBy(points: readonly HistoryPoint[], keyOf: (t: number) => number): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const p of points) {
    const key = keyOf(p.t);
    let last = out[out.length - 1];
    if (!last || last.t !== key) out.push((last = { t: key, rx: null, tx: null }));
    if (p.rx !== null) last.rx = (last.rx ?? 0) + p.rx;
    if (p.tx !== null) last.tx = (last.tx ?? 0) + p.tx;
  }
  return out;
}

const dayOf = (t: number) => {
  const d = new Date(t * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
};

const monthOf = (t: number) => {
  const d = new Date(t * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
};

/** Points (hourly or finer) summed per local day; days without any data stay null. */
export const byLocalDay = (points: readonly HistoryPoint[]) => groupBy(points, dayOf);

/** Points (daily or finer) summed per local calendar month. */
export const byLocalMonth = (points: readonly HistoryPoint[]) => groupBy(points, monthOf);

/** Start of the current billing period for a monthly reset day (1–31; short months use their last day). */
export function periodStart(resetDay: number, now: Date): number {
  const at = (year: number, month: number) => {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(resetDay, last));
  };
  let start = at(now.getFullYear(), now.getMonth());
  if (start.getTime() > now.getTime()) start = at(now.getFullYear(), now.getMonth() - 1);
  return Math.floor(start.getTime() / 1000);
}
