import { posixOffsetAt } from './posix-tz';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('posixOffsetAt', () => {
  it('reads fixed offsets (POSIX signs are inverted)', () => {
    expect(posixOffsetAt('CST-8', at('2026-07-01T00:00:00Z'))).toBe(8 * 3600);
    expect(posixOffsetAt('UTC', at('2026-07-01T00:00:00Z'))).toBe(0);
    expect(posixOffsetAt('UTC0', at('2026-07-01T00:00:00Z'))).toBe(0);
    expect(posixOffsetAt('<+04>-4', at('2026-07-01T00:00:00Z'))).toBe(4 * 3600);
    expect(posixOffsetAt('<-03>3', at('2026-07-01T00:00:00Z'))).toBe(-3 * 3600);
    expect(posixOffsetAt('IST-5:30', at('2026-07-01T00:00:00Z'))).toBe(5.5 * 3600);
  });

  it('follows northern daylight saving rules', () => {
    const berlin = 'CET-1CEST,M3.5.0,M10.5.0/3';
    expect(posixOffsetAt(berlin, at('2026-01-15T12:00:00Z'))).toBe(3600);
    expect(posixOffsetAt(berlin, at('2026-07-15T12:00:00Z'))).toBe(7200);
    // 2026-03-29 02:00 CET = 01:00 UTC starts summer time; 2026-10-25 03:00 CEST = 01:00 UTC ends it.
    expect(posixOffsetAt(berlin, at('2026-03-29T00:59:59Z'))).toBe(3600);
    expect(posixOffsetAt(berlin, at('2026-03-29T01:00:00Z'))).toBe(7200);
    expect(posixOffsetAt(berlin, at('2026-10-25T00:59:59Z'))).toBe(7200);
    expect(posixOffsetAt(berlin, at('2026-10-25T01:00:00Z'))).toBe(3600);
    const newYork = 'EST5EDT,M3.2.0,M11.1.0';
    expect(posixOffsetAt(newYork, at('2026-03-08T06:59:59Z'))).toBe(-5 * 3600);
    expect(posixOffsetAt(newYork, at('2026-03-08T07:00:00Z'))).toBe(-4 * 3600);
  });

  it('follows southern rules that wrap the new year', () => {
    const sydney = 'AEST-10AEDT,M10.1.0,M4.1.0/3';
    expect(posixOffsetAt(sydney, at('2026-01-15T00:00:00Z'))).toBe(11 * 3600);
    expect(posixOffsetAt(sydney, at('2026-07-15T00:00:00Z'))).toBe(10 * 3600);
    // Summer time ends 2026-04-05 03:00 AEDT = 2026-04-04 16:00 UTC.
    expect(posixOffsetAt(sydney, at('2026-04-04T15:59:59Z'))).toBe(11 * 3600);
    expect(posixOffsetAt(sydney, at('2026-04-04T16:00:00Z'))).toBe(10 * 3600);
  });

  it('treats unreadable strings as UTC', () => {
    expect(posixOffsetAt('', 0)).toBe(0);
    expect(posixOffsetAt('garbage', 0)).toBe(0);
  });
});
