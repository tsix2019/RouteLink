import type { TFunction } from 'i18next';

import type { AppT } from '@/i18n';
import { resources } from '@/i18n/resources';

import { brandHint } from './brand';
import { buildConfig, liveTexts, namesOf, pickSource, sampleOf, sampleOfLive } from './config';

const texts = liveTexts(((key: string) => key) as unknown as AppT);

describe('pickSource', () => {
  it('uses the plugin when it runs, LuCI counters otherwise (plan P4 §0.8)', () => {
    expect(pickSource(true, undefined, undefined)).toBe('demo');
    expect(pickSource(false, { state: 'ok', info: {} as never }, 'eth1')).toBe('agent');
    expect(pickSource(false, { state: 'not-installed' }, 'pppoe-wan')).toBe('luci');
    expect(pickSource(false, undefined, 'eth1')).toBe('luci');
    expect(pickSource(false, { state: 'not-running' }, undefined)).toBeNull();
  });
});

describe('namesOf', () => {
  it('maps upper-case MACs to the names the app shows, skipping bare MACs', () => {
    expect(
      namesOf([
        { mac: 'aa:bb:cc:00:00:01', name: '小明的 iPad' },
        { mac: 'AA:BB:CC:00:00:02', name: 'AA:BB:CC:00:00:02' },
      ]),
    ).toEqual({ 'AA:BB:CC:00:00:01': '小明的 iPad' });
    expect(namesOf(undefined)).toEqual({});
  });
});

describe('samples', () => {
  it('turns the plugin reply into the busiest five', () => {
    const devices = [1, 9, 3, 7, 5, 8].map((n) => ({ mac: `m${n}`, rxBps: n * 1000, txBps: 0 }));
    const sample = sampleOfLive({
      ts: 0,
      leaseUntil: 0,
      intervalSec: 2,
      wan: { rxBps: 100, txBps: 50 },
      online: 4,
      devices,
    });
    expect(sample.devices?.map((d) => d.mac)).toEqual(['m9', 'm8', 'm7', 'm5', 'm3']);
    expect(sample).toMatchObject({ rxBps: 100, txBps: 50, online: 4 });
  });

  it('takes the overview rates and leaves out an unknown count', () => {
    expect(sampleOf(undefined, 3)).toBeUndefined();
    expect(sampleOf({ rxBps: 1, txBps: 2 }, undefined)).toEqual({ rxBps: 1, txBps: 2 });
    expect(sampleOf({ rxBps: 1, txBps: 2 }, 3)).toEqual({ rxBps: 1, txBps: 2, online: 3 });
  });
});

describe('buildConfig', () => {
  const base = {
    routerId: 'r1',
    routerName: 'Home',
    intervalSec: 2,
    durationMin: 60 as const,
    names: {},
    texts,
  };

  it('hands the session and pinning over for a real router', () => {
    const config = buildConfig({
      ...base,
      source: 'luci',
      session: { endpoint: 'https://192.168.1.1/ubus', sid: 'abc' },
      tlsSha256: 'f'.repeat(64),
      wanDevice: 'eth1',
    });
    expect(config).toMatchObject({
      source: 'luci',
      session: { sid: 'abc' },
      tlsSha256: 'f'.repeat(64),
      wanDevice: 'eth1',
      durationMin: 60,
      link: 'routelink://overview',
    });
  });

  it('needs no session in demo mode, and refuses a real router without one', () => {
    expect(buildConfig({ ...base, source: 'demo', durationMin: null })).not.toHaveProperty('session');
    expect(() => buildConfig({ ...base, source: 'agent' })).toThrow('session');
  });

  it('passes every notification text, translated', () => {
    const t = ((key: string) => {
      const [ns, path] = key.split(':');
      return path
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], resources['zh-CN'][ns as 'live']);
    }) as unknown as TFunction;
    const zh = liveTexts(t as AppT);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(resources['zh-CN'].live.notification).sort());
    expect(zh.offlineTitle).toBe('路由器已离线');
    // The offline chip sits in the status bar: 7 characters at most.
    expect(resources['zh-CN'].live.notification.offlineChip.length).toBeLessThanOrEqual(7);
    expect(resources.en.live.notification.offlineChip.length).toBeLessThanOrEqual(7);
  });
});

describe('brandHint', () => {
  it.each([
    ['OnePlus', 'OnePlus', 'oneplus'],
    ['OPPO', 'OnePlus', 'oneplus'],
    ['OPPO', 'OPPO', 'oppo'],
    ['realme', 'realme', 'oppo'],
    ['Xiaomi', 'Redmi', 'xiaomi'],
    ['vivo', 'iQOO', 'vivo'],
    ['HONOR', 'HONOR', 'honor'],
    ['HUAWEI', 'HUAWEI', 'huawei'],
    ['samsung', 'samsung', 'samsung'],
    ['Google', 'google', null],
    [undefined, undefined, null],
  ])('%s / %s → %s', (manufacturer, brand, hint) => {
    expect(brandHint(manufacturer, brand)).toBe(hint);
  });
});
