import { niceBytesMax, niceMax } from './area-path';
import { runs, timeTicks } from './scale';

// jest.config.js runs tests in Asia/Shanghai (UTC+8, no daylight saving).
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('timeTicks', () => {
  it('uses clock times for a day and keeps ticks apart', () => {
    const ticks = timeTicks(sec('2026-10-05T00:00:00+08:00'), sec('2026-10-05T13:47:00+08:00'), 320, 'en');
    expect(ticks.map((t) => t.label)).toEqual(['00:00', '03:00', '06:00', '09:00', '12:00']);
    expect(ticks[0].t).toBe(sec('2026-10-05T00:00:00+08:00'));
  });

  it('uses finer steps for the last hour', () => {
    const end = sec('2026-10-05T13:47:00+08:00');
    const labels = timeTicks(end - 3600, end, 320, 'en').map((t) => t.label);
    expect(labels).toEqual(['13:00', '13:15', '13:30', '13:45']);
  });

  it('uses dates for a week, at local midnight', () => {
    const end = sec('2026-10-05T13:47:00+08:00');
    const ticks = timeTicks(end - 7 * 86400, end, 320, 'en');
    expect(ticks.every((t) => (t.t + 8 * 3600) % 86400 === 0)).toBe(true);
    expect(ticks[0].label).toBe('9/29');
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('uses months for a year', () => {
    const labels = timeTicks(sec('2025-10-05T00:00:00+08:00'), sec('2026-10-05T00:00:00+08:00'), 360, 'zh-CN').map(
      (t) => t.label,
    );
    expect(labels[0]).toBe('11月');
    expect(labels.length).toBeLessThanOrEqual(6);
  });

  it('returns nothing without room', () => {
    expect(timeTicks(0, 3600, 0, 'en')).toEqual([]);
  });
});

describe('runs', () => {
  it('splits a series at missing points', () => {
    const p = (rx: number | null) => ({ t: 0, rx, tx: rx });
    expect(runs([p(1), p(2), p(null), p(null), p(3), p(null)])).toEqual([
      { from: 0, to: 1, missing: false },
      { from: 2, to: 3, missing: true },
      { from: 4, to: 4, missing: false },
      { from: 5, to: 5, missing: true },
    ]);
    expect(runs([])).toEqual([]);
  });
});

describe('niceMax', () => {
  it('rounds axis maxima up to 1, 2 or 5 × 10^n', () => {
    expect([0.7, 1.3, 3, 7, 4_100_000].map(niceMax)).toEqual([1, 2, 5, 10, 5_000_000]);
  });
});

describe('niceBytesMax', () => {
  it('rounds in binary units', () => {
    expect(niceBytesMax(46 * 1024 ** 3)).toBe(50 * 1024 ** 3);
    expect(niceBytesMax(1.7 * 1024 ** 4)).toBe(2 * 1024 ** 4);
    expect(niceBytesMax(900)).toBe(1000);
  });
});
