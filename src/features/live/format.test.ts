import type { LiveMonitorTexts } from 'routelink-native';

import { resources } from '@/i18n/resources';

import {
  chipText,
  endsAtFor,
  fill,
  formatRemaining,
  LIVE_DURATIONS,
  lineText,
  offlineDuration,
  remainingMs,
  topText,
} from './format';

const zh = resources['zh-CN'].live.notification as LiveMonitorTexts;
const en = resources.en.live.notification as LiveMonitorTexts;

describe('chipText', () => {
  it.each([
    [12_345_678, '↓12.3M'],
    [8_100_000, '↓8.1M'],
    [999_960, '↓1.0M'],
    [99_960_000, '↓100M'],
    [150_000_000, '↓150M'],
    [1_250_000_000, '↓1.3G'],
    [500, '↓0.5K'],
    [45_000, '↓45.0K'],
    [0, '↓0K'],
    [Number.NaN, '↓0K'],
    [-5, '↓0K'],
  ])('%p bit/s → %s', (bps, text) => {
    expect(chipText(bps)).toBe(text);
  });

  it('never exceeds the 7 characters the status bar shows in full', () => {
    for (let exp = 0; exp <= 16; exp += 0.01) {
      const bps = 10 ** exp;
      expect([bps, chipText(bps).length <= 7]).toEqual([bps, true]);
    }
  });
});

describe('notification lines', () => {
  const sample = {
    rxBps: 12_300_000,
    txBps: 1_200_000,
    online: 18,
    devices: [
      { mac: 'aa:bb:cc:00:00:02', rxBps: 300_000, txBps: 20_000 },
      { mac: 'aa:bb:cc:00:00:01', rxBps: 8_100_000, txBps: 400_000 },
    ],
  };
  const names = { 'AA:BB:CC:00:00:01': '小明的 iPad' };

  it('reads like design §16 in Chinese', () => {
    expect(lineText(zh, sample)).toBe('↓ 12.3 Mbps ↑ 1.2 Mbps · 18 台在线');
    expect(topText(zh, sample, names)).toBe('占用最多：小明的 iPad ↓ 8.1 Mbps');
  });

  it('reads naturally in English', () => {
    expect(lineText(en, sample)).toBe('↓ 12.3 Mbps ↑ 1.2 Mbps · 18 online');
    expect(topText(en, sample, names)).toBe('Busiest: 小明的 iPad ↓ 8.1 Mbps');
  });

  it('leaves out the online count while it is unknown', () => {
    expect(lineText(zh, { rxBps: 0, txBps: 0 })).toBe('↓ 0 bps ↑ 0 bps');
  });

  it('names an unnamed device by its MAC and shows an upload when that dominates', () => {
    const up = { rxBps: 0, txBps: 0, devices: [{ mac: 'AA:BB:CC:00:00:09', rxBps: 10_000, txBps: 5_000_000 }] };
    expect(topText(en, up, {})).toBe('Busiest: AA:BB:CC:00:00:09 ↑ 5.0 Mbps');
  });

  it('has no second line without devices (no plugin) or when nothing moves', () => {
    expect(topText(zh, { rxBps: 1, txBps: 1 }, names)).toBeNull();
    const idle = { rxBps: 0, txBps: 0, devices: [{ mac: 'AA:BB:CC:00:00:01', rxBps: 7_000, txBps: 0 }] };
    expect(topText(zh, idle, names)).toBeNull();
  });

  it('fills every placeholder, leaving unknown ones alone', () => {
    expect(fill('{a} {b} {a}', { a: 1 })).toBe('1 {b} 1');
  });
});

describe('durations', () => {
  it('says how long the router was offline', () => {
    expect(offlineDuration(42_000, zh)).toBe('42 秒');
    expect(offlineDuration(200_000, zh)).toBe('3 分 20 秒');
    expect(offlineDuration(3_900_000, zh)).toBe('1 小时 5 分');
    expect(offlineDuration(200_000, en)).toBe('3m 20s');
    expect(offlineDuration(-1, en)).toBe('0s');
  });

  it('offers 30 minutes, 1 hour, 4 hours and unlimited', () => {
    expect(LIVE_DURATIONS).toEqual([30, 60, 240, null]);
    expect(endsAtFor(30, 1_000)).toBe(1_000 + 1_800_000);
    expect(endsAtFor(240, 0)).toBe(14_400_000);
    expect(endsAtFor(null, 1_000)).toBeNull();
  });

  it('counts down on the button', () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 12_000)).toBe(0);
    expect(remainingMs(null, 0)).toBeNull();
    expect(formatRemaining(1_800_000)).toBe('30:00');
    expect(formatRemaining(1_799_001)).toBe('30:00');
    expect(formatRemaining(1_799_000)).toBe('29:59');
    expect(formatRemaining(14_400_000)).toBe('4:00:00');
    expect(formatRemaining(3_605_000)).toBe('1:00:05');
    expect(formatRemaining(0)).toBe('0:00');
  });
});
