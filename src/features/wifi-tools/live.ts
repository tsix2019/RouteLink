import type { SignalHistory, SignalPoint } from '@/api/services/agent-wifi';
import type { HourWindow } from '@/features/traffic/timeRange';

/** Signal samples for the detail page's charts (design §17.1, WF-1). */

export interface LiveSample {
  /** Epoch seconds. */
  t: number;
  /** dBm */
  signal: number | null;
  /** kbit/s */
  txRate: number | null;
  rxRate: number | null;
}

/** The live chart shows the last five minutes, like the plugin's in-memory ring. */
export const LIVE_WINDOW_SEC = 300;

const keep = (samples: readonly LiveSample[], now: number, windowSec: number) =>
  samples.filter((s) => s.t > now - windowSec && s.t <= now);

/** Adds a sample (replacing one of the same second) and drops what fell out of the window. */
export function appendSample(
  samples: readonly LiveSample[],
  sample: LiveSample,
  now = sample.t,
  windowSec = LIVE_WINDOW_SEC,
): LiveSample[] {
  const rest = samples.filter((s) => s.t !== sample.t);
  rest.push(sample);
  rest.sort((a, b) => a.t - b.t);
  return keep(rest, now, windowSec);
}

/** History points as samples (the plugin's per-second ring when the range is the last few minutes). */
export const samplesOf = (points: readonly SignalPoint[]): LiveSample[] =>
  points.map((p) => ({ t: p.t, signal: p.signal, txRate: p.txRate, rxRate: p.rxRate }));

/**
 * What the router remembered before the page opened, followed by what the page has sampled since. Seed
 * points from the time the page has its own samples for are dropped.
 */
export function mergeLive(
  seed: readonly LiveSample[],
  live: readonly LiveSample[],
  now: number,
  windowSec = LIVE_WINDOW_SEC,
): LiveSample[] {
  const first = live.length ? live[0].t : Infinity;
  const older = seed.filter((s) => s.t < first && s.signal !== null);
  return keep([...older, ...live], now, windowSec).sort((a, b) => a.t - b.t);
}

const known = (h: SignalHistory) => h.points.reduce((n, p) => n + (p.signal === null ? 0 : 1), 0);

/**
 * A client's history from every router of the group that recorded it: while it roamed each AP only has
 * its own part. Histories on the same time grid are merged point by point (the AP that heard it better
 * wins); otherwise the one with the most data is kept.
 */
export function mergeHistories(histories: readonly SignalHistory[]): SignalHistory | null {
  const withData = histories.filter((h) => known(h) > 0);
  if (!withData.length) return histories[0] ?? null;
  const base = withData.reduce((a, b) => (known(b) > known(a) ? b : a));
  const aligned = withData.filter(
    (h) =>
      h !== base &&
      h.step === base.step &&
      h.points.length === base.points.length &&
      h.points.every((p, i) => p.t === base.points[i].t),
  );
  if (!aligned.length) return base;
  return {
    ...base,
    points: base.points.map((p, i) => {
      let best = p;
      for (const h of aligned) {
        const q = h.points[i];
        if (q.signal !== null && (best.signal === null || q.signal > best.signal)) best = q;
      }
      return best;
    }),
  };
}

/**
 * Only some hours of each day (the range picker's daily window), in the phone's time zone. The plugin's
 * `signal` method has no hour filter, so points outside the window become gaps.
 */
export function filterHours(points: readonly SignalPoint[], hours?: HourWindow): SignalPoint[] {
  if (!hours || hours.from === hours.to) return [...points];
  const inside = (h: number) =>
    hours.from < hours.to ? h >= hours.from && h < hours.to : h >= hours.from || h < hours.to;
  return points.map((p) =>
    inside(new Date(p.t * 1000).getHours())
      ? p
      : { t: p.t, signal: null, minSignal: null, txRate: null, rxRate: null, retries: null, failed: null },
  );
}

/** Sent-frame retries and failures over a history (deltas per point). */
export function historyRetries(points: readonly SignalPoint[]): { retries: number; failed: number } | null {
  let retries = 0;
  let failed = 0;
  let any = false;
  for (const p of points) {
    if (p.retries === null && p.failed === null) continue;
    any = true;
    retries += p.retries ?? 0;
    failed += p.failed ?? 0;
  }
  return any ? { retries, failed } : null;
}

/** Average and weakest signal over a history (rounded dBm), null without data. */
export function signalStats(points: readonly SignalPoint[]): { avg: number; min: number } | null {
  let sum = 0;
  let n = 0;
  let min = Infinity;
  for (const p of points) {
    if (p.signal === null) continue;
    sum += p.signal;
    n++;
    min = Math.min(min, p.minSignal ?? p.signal);
  }
  return n ? { avg: Math.round(sum / n), min } : null;
}
