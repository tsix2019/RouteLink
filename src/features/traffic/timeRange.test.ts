import { initI18n, i18n } from '@/i18n';

import {
  hoursMask,
  parseRange,
  rangeLabel,
  resolveRange,
  serializeRange,
  validateCustom,
  type TimeRange,
} from './timeRange';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

// Presets follow the phone's time zone (design §15); jest.config.js runs every test in Asia/Shanghai.

const at = (iso: string) => new Date(iso);
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const preset = (id: Extract<TimeRange, { kind: 'preset' }>['id']): TimeRange => ({ kind: 'preset', id });

describe('resolveRange', () => {
  const now = at('2026-10-05T13:47:20+08:00');

  it('today runs from local midnight to now', () => {
    expect(resolveRange(preset('today'), now)).toEqual({
      start: sec('2026-10-05T00:00:00+08:00'),
      end: sec('2026-10-05T13:47:20+08:00'),
    });
  });

  it('yesterday is the whole previous day', () => {
    expect(resolveRange(preset('yesterday'), now)).toEqual({
      start: sec('2026-10-04T00:00:00+08:00'),
      end: sec('2026-10-05T00:00:00+08:00'),
    });
  });

  it('last month is the whole previous calendar month', () => {
    expect(resolveRange(preset('lastMonth'), at('2026-03-10T09:00:00+08:00'))).toEqual({
      start: sec('2026-02-01T00:00:00+08:00'),
      end: sec('2026-03-01T00:00:00+08:00'),
    });
    expect(resolveRange(preset('lastMonth'), at('2026-01-15T09:00:00+08:00')).start).toBe(
      sec('2025-12-01T00:00:00+08:00'),
    );
  });

  it('this month starts on the 1st', () => {
    expect(resolveRange(preset('thisMonth'), now).start).toBe(sec('2026-10-01T00:00:00+08:00'));
  });

  it('rolling windows count back from now', () => {
    const end = sec('2026-10-05T13:47:20+08:00');
    expect(resolveRange(preset('lastHour'), now)).toEqual({ start: end - 3600, end });
    expect(resolveRange(preset('last7d'), now)).toEqual({ start: end - 7 * 86400, end });
    expect(resolveRange(preset('last30d'), now)).toEqual({ start: end - 30 * 86400, end });
  });

  it('cuts custom ranges at now', () => {
    const r: TimeRange = {
      kind: 'custom',
      start: sec('2026-10-05T08:00:00+08:00'),
      end: sec('2026-10-06T08:00:00+08:00'),
    };
    expect(resolveRange(r, now)).toEqual({ start: r.start, end: sec('2026-10-05T13:47:20+08:00') });
  });
});

describe('hoursMask', () => {
  it('sets one bit per hour, end exclusive', () => {
    expect(hoursMask({ from: 20, to: 23 })).toBe((1 << 20) | (1 << 21) | (1 << 22));
  });

  it('wraps around midnight', () => {
    const mask = hoursMask({ from: 22, to: 6 });
    const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => mask & (1 << h));
    expect(hours).toEqual([0, 1, 2, 3, 4, 5, 22, 23]);
  });

  it('treats from = to as the whole day', () => {
    expect(hoursMask({ from: 8, to: 8 })).toBe(0xffffff);
  });
});

describe('validateCustom', () => {
  const now = sec('2026-10-05T13:47:20+08:00');

  it('accepts a past range', () => {
    expect(validateCustom(now - 3600, now, now)).toBe('ok');
  });

  it('rejects an end before the start', () => {
    expect(validateCustom(now, now - 60, now)).toBe('empty');
    expect(validateCustom(now, now, now)).toBe('empty');
  });

  it('rejects ranges that start in the future', () => {
    expect(validateCustom(now + 60, now + 3600, now)).toBe('future');
  });

  it('rejects more than ten years', () => {
    expect(validateCustom(now - 11 * 365 * 86400, now, now)).toBe('too-long');
  });
});

describe('rangeLabel', () => {
  beforeAll(async () => {
    initI18n('en');
    await i18n.changeLanguage('en');
  });
  const now = at('2026-10-05T13:47:20+08:00');

  it('shows one date when the range stays within a day', () => {
    expect(rangeLabel(i18n.t, preset('today'), 'en', now)).toBe('Oct 5, 00:00 – 13:47');
  });

  it('shows both dates otherwise, and the daily hours', () => {
    const r: TimeRange = { kind: 'preset', id: 'last7d', hours: { from: 20, to: 23 } };
    expect(rangeLabel(i18n.t, r, 'en', now)).toBe('Sep 28, 13:47 – Oct 5, 13:47 · daily 20:00–23:00');
  });

  it('writes Chinese dates the Chinese way', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(rangeLabel(i18n.t, preset('yesterday'), 'zh-CN', now)).toBe('10月4日 00:00 – 10月5日 00:00');
    await i18n.changeLanguage('en');
  });
});

describe('serializeRange / parseRange', () => {
  it.each<TimeRange>([
    { kind: 'preset', id: 'today' },
    { kind: 'preset', id: 'last7d', hours: { from: 20, to: 23 } },
    { kind: 'custom', start: 1_791_100_000, end: 1_791_186_400 },
    { kind: 'custom', start: 1_791_100_000, end: 1_791_186_400, hours: { from: 22, to: 6 } },
  ])('round-trips %j', (r) => {
    expect(parseRange(serializeRange(r))).toEqual({ hours: undefined, ...r });
  });

  it('rejects garbage', () => {
    expect(parseRange(undefined)).toBeNull();
    expect(parseRange('yesterday-ish')).toBeNull();
    expect(parseRange('20-10')).toBeNull();
  });
});
