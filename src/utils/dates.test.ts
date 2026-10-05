import {
  formatClock,
  formatDate,
  formatDay,
  formatDayTime,
  formatMonth,
  formatMonthYear,
  formatNumericDay,
} from './dates';

// jest.config.js: Asia/Shanghai.
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const t = sec('2026-10-05T09:07:00+08:00');

describe('dates', () => {
  it('writes day and time in both languages', () => {
    expect(formatDayTime(t, 'zh-CN')).toBe('10月5日 09:07');
    expect(formatDayTime(t, 'en')).toBe('Oct 5, 09:07');
    expect(formatDayTime(t, 'zh-CN', { year: true })).toBe('2026年10月5日 09:07');
    expect(formatDayTime(t, 'en', { year: true })).toBe('Oct 5, 2026, 09:07');
  });

  it('can read a wall time stored as UTC (router local time)', () => {
    expect(formatDayTime(sec('2026-10-05T12:46:00Z'), 'zh-CN', { utc: true })).toBe('10月5日 12:46');
  });

  it('writes clock times with seconds when asked', () => {
    expect(formatClock(t)).toBe('09:07');
    expect(formatClock(t + 5, { seconds: true })).toBe('09:07:05');
  });

  it('writes days, months and dates', () => {
    expect(formatDay(t, 'zh-CN')).toBe('10月5日');
    expect(formatDay(t, 'en', { weekday: true })).toBe('Mon, Oct 5');
    expect(formatDay(t, 'zh-CN', { weekday: true })).toBe('10月5日 周一');
    expect(formatNumericDay(t)).toBe('10/5');
    expect(formatMonth(t, 'zh-CN')).toBe('10月');
    expect(formatMonth(t, 'en')).toBe('Oct');
    expect(formatMonthYear(t, 'zh-CN')).toBe('2026年10月');
    expect(formatMonthYear(t, 'en')).toBe('October 2026');
    expect(formatDate(t, 'zh-CN')).toBe('2026年10月5日');
    expect(formatDate(t, 'en')).toBe('Oct 5, 2026');
  });
});
