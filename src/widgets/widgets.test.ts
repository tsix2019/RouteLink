import { i18n, initI18n } from '@/i18n';

import { resetWidgetThrottle, updateWidgetFromApp } from './fromApp';
import { widgetProps } from './props';

initI18n('system');
const zh = i18n.getFixedT('zh-CN');
const t = zh as unknown as Parameters<typeof widgetProps>[0];

describe('widget', () => {
  it('turns the router state into ready-made text', () => {
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

  it('redraws for news, otherwise at most every ten minutes', () => {
    resetWidgetThrottle();
    const input = { name: 'Home', online: true, devicesOnline: 13, updatedAt: 0 };
    expect(updateWidgetFromApp(t, input, 0)).toBe(true);
    expect(updateWidgetFromApp(t, input, 60_000)).toBe(false);
    expect(updateWidgetFromApp(t, { ...input, devicesOnline: 14 }, 61_000)).toBe(true);
    expect(updateWidgetFromApp(t, { ...input, devicesOnline: 14 }, 61_000 + 10 * 60_000)).toBe(true);
  });
});
