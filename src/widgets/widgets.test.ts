import { DemoConnection } from '@/api/connection/demo/connection';
import type { RouterConnection } from '@/api/connection/types';
import { NativeError } from '@/api/http/errors';
import { i18n, initI18n } from '@/i18n';

import { WIDGETS } from './catalog';
import { resetWidgetThrottle, updateWidgetFromApp } from './fromApp';
import { coldStartRoute, takePendingRoute, widgetRoute } from './links';
import { addWidget, type PinDeps } from './pin';
import { widgetProps } from './props';
import { readWidgetData } from './read';
import { sampleWidgetData } from './sample';
import { widgetView } from './view';

initI18n('system');
const zh = i18n.getFixedT('zh-CN');
const t = zh as unknown as Parameters<typeof widgetProps>[0];
const en = i18n.getFixedT('en') as unknown as Parameters<typeof widgetProps>[0];

describe('widget', () => {
  it('turns the router state into ready-made text for iOS', () => {
    const at = new Date(2026, 9, 6, 9, 41).getTime();
    expect(
      widgetProps(t, {
        name: 'Home',
        online: true,
        devicesOnline: 13,
        rxBps: 34_700_000,
        txBps: 6_400_000,
        updatedAt: at,
      }),
    ).toEqual({
      title: 'Home',
      online: true,
      status: '在线',
      devices: '13 台设备在线',
      down: '↓ 34.7 Mbps',
      up: '↑ 6.4 Mbps',
      updated: '更新于 09:41',
    });
    expect(widgetProps(t, { name: 'Home', online: false, rxBps: 1, updatedAt: at })).toMatchObject({
      status: '连不上',
      devices: '—',
      down: '',
    });
  });

  it('formats everything the Android widgets show', () => {
    const at = new Date(2026, 9, 6, 9, 41).getTime();
    const v = widgetView(t, 'zh-CN', sampleWidgetData(at));
    expect(v).toMatchObject({
      empty: false,
      title: 'RouteLink',
      status: '在线',
      updated: '更新于 09:41',
      time: '09:41',
      refreshable: true,
      devicesCount: '13',
      devices: '13 台设备在线',
      devicesSplit: 'Wi‑Fi 9 · 有线 4',
      down: '34.7 Mbps',
      up: '6.4 Mbps',
      cpu: { value: '23%', ratio: 0.23 },
      memory: { value: '41%', ratio: 0.41 },
      temperature: '48.5 °C',
      uptime: '已运行 3 天 4 小时',
      wanUp: true,
      wanStatus: '已连接 · PPPoE',
      wanIp: '203.0.113.45',
    });
    expect(v.deviceNames).toHaveLength(6);
    expect(widgetView(en, 'en', sampleWidgetData(at)).uptime).toBe('Up 3d 4h');
  });

  it('shows nothing stale for a router that cannot be reached, and says what to do before the first read', () => {
    const v = widgetView(t, 'zh-CN', { ...sampleWidgetData(0), online: false });
    expect(v).toMatchObject({ status: '连不上', devicesCount: '—', down: '—', wanStatus: '连不上', wanIp: '' });
    expect(v.cpu).toBeUndefined();
    expect(v.deviceNames).toEqual([]);
    expect(widgetView(t, 'zh-CN', null)).toMatchObject({ empty: true, status: '打开 App 看看路由器', refreshable: false });
    expect(widgetView(t, 'zh-CN', null, { refreshing: true }).updated).toBe('正在刷新…');
  });

  it('has a name and a description for every widget, in both languages', () => {
    for (const lang of [t, en]) {
      for (const w of WIDGETS) {
        expect(lang(`widget.kinds.${w.key}.name`)).not.toContain('widget.');
        expect(lang(`widget.kinds.${w.key}.description`)).not.toContain('widget.');
      }
    }
  });

  it('redraws for news, otherwise at most every ten minutes', () => {
    resetWidgetThrottle();
    const input = { name: 'Home', online: true, devicesOnline: 13, updatedAt: 0 };
    expect(updateWidgetFromApp(input, 0)).toBe(true);
    expect(updateWidgetFromApp(input, 60_000)).toBe(false);
    expect(updateWidgetFromApp({ ...input, devicesOnline: 14 }, 61_000)).toBe(true);
    expect(updateWidgetFromApp({ ...input, devicesOnline: 14 }, 61_000 + 10 * 60_000)).toBe(true);
  });

  it('redraws once the rates are known: the first reading usually comes before them', () => {
    resetWidgetThrottle();
    const input = { name: 'Home', online: true, devicesOnline: 13, updatedAt: 0 };
    expect(updateWidgetFromApp(input, 0)).toBe(true);
    expect(updateWidgetFromApp({ ...input, rxBps: 1_000, txBps: 2_000 }, 2_000)).toBe(true);
    expect(updateWidgetFromApp({ ...input, rxBps: 3_000, txBps: 4_000 }, 4_000)).toBe(false);
  });
});

describe('reading the router for the widgets', () => {
  it('reads state, devices, resources, WAN and the rates over a second', async () => {
    let clock = 1_800_000_000_000;
    const conn = new DemoConnection(2026, () => clock, 0);
    const sleep = jest.fn(async (ms: number) => {
      clock += ms;
    });
    const data = await readWidgetData(conn, 'Demo', sleep, () => clock);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(data).toMatchObject({ name: 'Demo', online: true, wanUp: true, wanProto: 'pppoe' });
    expect(data.devicesOnline).toBeGreaterThan(0);
    expect(data.wifi! + data.wired!).toBe(data.devicesOnline);
    expect(data.deviceNames!.length).toBeGreaterThan(0);
    expect(data.rxBps).toBeGreaterThan(0);
    expect(data.txBps).toBeGreaterThan(0);
    expect(data.cpu).toBeGreaterThanOrEqual(0);
    expect(data.memory).toBeGreaterThan(0);
    expect(data.wanIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('calls a router that does not answer offline, and lets other failures through', async () => {
    const failing = (error: Error): RouterConnection => {
      const fail = () => Promise.reject(error);
      return { routerId: 'home', kind: 'live', call: fail, batch: fail, ping: async () => false };
    };
    const sleep = async () => undefined;
    await expect(
      readWidgetData(failing(new NativeError('ERR_TIMEOUT', 'timed out')), 'Home', sleep, () => 5),
    ).resolves.toEqual({ name: 'Home', online: false, updatedAt: 5 });
    await expect(readWidgetData(failing(new Error('access denied')), 'Home', sleep)).rejects.toThrow('access denied');
  });
});

describe('adding a widget from the app', () => {
  const deps = (over: Partial<PinDeps> & { counts: number[] }): PinDeps => {
    const counts = [...over.counts];
    return {
      pin: async () => true,
      count: async () => (counts.length > 1 ? counts.shift()! : counts[0]),
      promptShown: async () => true,
      back: async () => undefined,
      sleep: async () => undefined,
      ...over,
    };
  };

  it('knows when the widget made it to the home screen', async () => {
    expect(await addWidget('SpeedWidget', deps({ counts: [0, 0, 1] }))).toBe('added');
  });

  it('tells a launcher that showed nothing (the permission is off) from a prompt the user closed', async () => {
    expect(await addWidget('SpeedWidget', deps({ counts: [0], promptShown: async () => false }))).toBe('blocked');
    expect(await addWidget('SpeedWidget', deps({ counts: [0] }))).toBe('dismissed');
  });

  it('falls back to adding by hand when the launcher cannot pin', async () => {
    expect(await addWidget('SpeedWidget', deps({ counts: [0], pin: async () => false }))).toBe('unsupported');
    expect(await addWidget('SpeedWidget', deps({ counts: [0], pin: undefined }))).toBe('unsupported');
  });
});

describe('links from the widgets', () => {
  it("recognises the widgets' own links and leaves the others alone", () => {
    expect(widgetRoute('routelink://devices')).toBe('/devices');
    expect(widgetRoute('routelink://wifi-qr')).toBe('/wifi-qr');
    expect(widgetRoute('routelink://overview/')).toBe('/overview');
    expect(widgetRoute('routelink://demo?lang=zh&route=/devices')).toBeNull();
    expect(widgetRoute('routelink://more/backup')).toBeNull();
    expect(widgetRoute('https://example.com/devices')).toBeNull();
  });

  it('opens a sheet over the overview on a cold start, so there is somewhere to go back to', () => {
    expect(coldStartRoute('/devices')).toBeNull();
    expect(takePendingRoute()).toBeNull();
    expect(coldStartRoute('/wifi-qr')).toBe('/overview');
    expect(takePendingRoute()).toBe('/wifi-qr');
    expect(takePendingRoute()).toBeNull();
  });
});
