import type { WidgetData } from './data';

/** What the app previews the widgets with before any router was read. */
export const sampleWidgetData = (now: number): WidgetData => ({
  name: 'RouteLink',
  online: true,
  refreshable: true,
  devicesOnline: 13,
  devicesTotal: 21,
  wifi: 9,
  wired: 4,
  deviceNames: ['iPhone', 'MacBook Air', 'Living Room TV', 'iPad', 'Nintendo Switch', 'NAS'],
  rxBps: 34_700_000,
  txBps: 6_400_000,
  cpu: 0.23,
  memory: 0.41,
  temperature: 48.5,
  uptimeSec: 273_600,
  wanUp: true,
  wanIp: '203.0.113.45',
  wanProto: 'pppoe',
  updatedAt: now,
});
