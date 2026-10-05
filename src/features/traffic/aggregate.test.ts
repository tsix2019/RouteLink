import { byLocalDay, byLocalMonth, periodStart } from './aggregate';

// jest.config.js: Asia/Shanghai.
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const pt = (iso: string, rx: number | null, tx: number | null = rx) => ({ t: sec(iso), rx, tx });

describe('byLocalDay', () => {
  it('sums hourly points into local days, keeping days without data as null', () => {
    const days = byLocalDay([
      pt('2026-10-03T23:00:00+08:00', 5),
      pt('2026-10-04T00:00:00+08:00', 1),
      pt('2026-10-04T23:00:00+08:00', 2),
      pt('2026-10-05T00:00:00+08:00', null),
      pt('2026-10-05T01:00:00+08:00', null),
    ]);
    expect(days).toEqual([
      { t: sec('2026-10-03T00:00:00+08:00'), rx: 5, tx: 5 },
      { t: sec('2026-10-04T00:00:00+08:00'), rx: 3, tx: 3 },
      { t: sec('2026-10-05T00:00:00+08:00'), rx: null, tx: null },
    ]);
  });
});

describe('byLocalMonth', () => {
  it('sums daily points into calendar months', () => {
    expect(
      byLocalMonth([
        pt('2026-09-30T00:00:00+08:00', 1),
        pt('2026-10-01T00:00:00+08:00', 2),
        pt('2026-10-31T00:00:00+08:00', 3),
      ]),
    ).toEqual([
      { t: sec('2026-09-01T00:00:00+08:00'), rx: 1, tx: 1 },
      { t: sec('2026-10-01T00:00:00+08:00'), rx: 5, tx: 5 },
    ]);
  });
});

describe('periodStart', () => {
  const now = new Date('2026-10-05T13:00:00+08:00');

  it('is this month’s reset day once it has passed', () => {
    expect(periodStart(3, now)).toBe(sec('2026-10-03T00:00:00+08:00'));
  });

  it('is last month’s reset day before it', () => {
    expect(periodStart(15, now)).toBe(sec('2026-09-15T00:00:00+08:00'));
  });

  it('uses the last day of short months', () => {
    expect(periodStart(31, new Date('2026-03-02T09:00:00+08:00'))).toBe(sec('2026-02-28T00:00:00+08:00'));
  });
});
