import type { SignalHistory, SignalPoint } from '@/api/services/agent-wifi';

import {
  appendSample,
  filterHours,
  historyRetries,
  mergeHistories,
  mergeLive,
  samplesOf,
  signalStats,
  type LiveSample,
} from './live';

const s = (t: number, signal: number | null = -60): LiveSample => ({ t, signal, txRate: 100_000, rxRate: 50_000 });
const p = (t: number, signal: number | null, o: Partial<SignalPoint> = {}): SignalPoint => ({
  t,
  signal,
  minSignal: signal,
  txRate: signal === null ? null : 100_000,
  rxRate: signal === null ? null : 50_000,
  retries: signal === null ? null : 2,
  failed: signal === null ? null : 0,
  ...o,
});
const history = (points: SignalPoint[], step = 60): SignalHistory => ({
  start: points[0]?.t ?? 0,
  end: (points[points.length - 1]?.t ?? 0) + step,
  step,
  tier: 'minute',
  points,
});

describe('appendSample', () => {
  it('keeps samples in order, replaces the same second and drops what left the window', () => {
    let buf: LiveSample[] = [];
    buf = appendSample(buf, s(100, -60));
    buf = appendSample(buf, s(102, -62));
    buf = appendSample(buf, s(101, -61));
    buf = appendSample(buf, s(102, -63));
    expect(buf.map((x) => [x.t, x.signal])).toEqual([
      [100, -60],
      [101, -61],
      [102, -63],
    ]);
    buf = appendSample(buf, s(402, -70));
    expect(buf.map((x) => x.t)).toEqual([402]);
  });

  it('does not change the input', () => {
    const buf = [s(1)];
    appendSample(buf, s(2));
    expect(buf).toHaveLength(1);
  });
});

describe('mergeLive', () => {
  it('puts the router’s memory before the page’s own samples', () => {
    const seed = samplesOf([p(990, -50), p(995, null), p(1000, -55), p(1005, -56)]);
    const live = [s(1003, -58), s(1004, -59)];
    expect(mergeLive(seed, live, 1004).map((x) => [x.t, x.signal])).toEqual([
      [990, -50],
      [1000, -55],
      [1003, -58],
      [1004, -59],
    ]);
  });

  it('trims to the window', () => {
    expect(mergeLive(samplesOf([p(100, -50)]), [s(500)], 500).map((x) => x.t)).toEqual([500]);
    expect(mergeLive(samplesOf([p(300, -50)]), [], 500).map((x) => x.t)).toEqual([300]);
  });
});

describe('mergeHistories', () => {
  it('fills one AP’s gaps with the other’s points and keeps the stronger where both heard it', () => {
    const gw = history([p(0, -60), p(60, null), p(120, -70), p(180, -65)]);
    const ap = history([p(0, null), p(60, -55), p(120, -50), p(180, null)]);
    expect(mergeHistories([gw, ap])!.points.map((x) => x.signal)).toEqual([-60, -55, -50, -65]);
  });

  it('keeps the one with most data when the grids differ', () => {
    const minute = history([p(0, -60), p(60, -61), p(120, -62)]);
    const hour = history([p(0, -60)], 3600);
    expect(mergeHistories([hour, minute])).toBe(minute);
  });

  it('returns the first history when none has data, and null without any', () => {
    const empty = history([p(0, null)]);
    expect(mergeHistories([empty, history([p(0, null)])])).toBe(empty);
    expect(mergeHistories([])).toBeNull();
  });
});

describe('filterHours', () => {
  const at = (h: number) => Math.floor(new Date(2026, 9, 6, h, 30).getTime() / 1000);
  const points = [p(at(7), -60), p(at(12), -60), p(at(21), -60), p(at(23), -60)];

  it('blanks points outside the daily window', () => {
    expect(filterHours(points, { from: 20, to: 23 }).map((x) => x.signal)).toEqual([null, null, -60, null]);
  });

  it('handles windows across midnight and the whole day', () => {
    expect(filterHours(points, { from: 22, to: 8 }).map((x) => x.signal)).toEqual([-60, null, null, -60]);
    expect(filterHours(points, { from: 5, to: 5 })).toEqual(points);
    expect(filterHours(points)).toEqual(points);
  });
});

it('sums retries and failures, null without data', () => {
  expect(historyRetries([p(0, -60, { retries: 5, failed: 1 }), p(60, null), p(120, -60, { retries: 3 })])).toEqual({
    retries: 8,
    failed: 1,
  });
  expect(historyRetries([p(0, null)])).toBeNull();
});

it('averages the signal and finds the weakest minute', () => {
  expect(signalStats([p(0, -60, { minSignal: -72 }), p(60, null), p(120, -64)])).toEqual({ avg: -62, min: -72 });
  expect(signalStats([p(0, null)])).toBeNull();
});
