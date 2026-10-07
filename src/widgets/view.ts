import type { AppT } from '@/i18n';
import { formatBitRate, formatDuration, formatPercent, protoLabel, type Lang } from '@/utils/format';

import type { WidgetData } from './data';
import { hhmm } from './props';

export interface Gauge {
  /** "42%" */
  value: string;
  /** 0..1, for the bar */
  ratio: number;
}

/** Everything Android's widgets draw, as text in the app's language (and ratios for the bars). */
export interface WidgetView {
  /** Nothing read yet. */
  empty: boolean;
  title: string;
  online: boolean;
  status: string;
  /** "Updated 09:41", or "Refreshing…" while ↻ reads the router. */
  updated: string;
  /** "09:41" (or "…"), where there is no room for `updated`. */
  time: string;
  refreshable: boolean;
  refreshing: boolean;
  /** "13", or "—" */
  devicesCount: string;
  /** "13 devices online" */
  devices: string;
  /** "Wi-Fi 9 · Wired 4" */
  devicesSplit: string;
  deviceNames: string[];
  /** "34.7 Mbps", or "—" */
  down: string;
  up: string;
  cpu?: Gauge;
  memory?: Gauge;
  /** "48.5 °C" */
  temperature?: string;
  /** "Up 3d 4h" */
  uptime?: string;
  wanUp: boolean;
  /** "Connected · PPPoE" */
  wanStatus: string;
  wanIp: string;
  labels: {
    down: string;
    up: string;
    devices: string;
    cpu: string;
    memory: string;
    temperature: string;
    wan: string;
    refresh: string;
    wifiQr: string;
    devicesShortcut: string;
    terminal: string;
    assistant: string;
    traffic: string;
  };
}

const gauge = (r: number): Gauge => ({ value: formatPercent(r), ratio: Math.min(1, Math.max(0, r)) });

export function widgetView(
  t: AppT,
  lang: Lang,
  data: WidgetData | null,
  options: { refreshing?: boolean } = {},
): WidgetView {
  const labels = {
    down: t('widget.down'),
    up: t('widget.up'),
    devices: t('widget.kinds.devices.name'),
    cpu: t('widget.cpu'),
    memory: t('widget.memory'),
    temperature: t('widget.temperature'),
    wan: t('widget.wan'),
    refresh: t('widget.refresh'),
    wifiQr: t('widget.shortcut.wifiQr'),
    devicesShortcut: t('widget.shortcut.devices'),
    terminal: t('widget.shortcut.terminal'),
    assistant: t('widget.shortcut.assistant'),
    traffic: t('widget.shortcut.traffic'),
  };
  const refreshing = !!options.refreshing;
  if (!data) {
    return {
      empty: true,
      title: 'RouteLink',
      online: false,
      status: t('widget.noData'),
      updated: refreshing ? t('widget.refreshing') : '',
      time: refreshing ? '…' : '',
      refreshable: false,
      refreshing,
      devicesCount: '—',
      devices: '—',
      devicesSplit: '',
      deviceNames: [],
      down: '—',
      up: '—',
      wanUp: false,
      wanStatus: '—',
      wanIp: '',
      labels,
    };
  }
  const on = data.online;
  const rate = (bps?: number) => (on && bps !== undefined ? formatBitRate(bps) : '—');
  const split = [
    data.wifi !== undefined ? t('widget.wifiCount', { n: data.wifi }) : '',
    data.wired !== undefined ? t('widget.wiredCount', { n: data.wired }) : '',
  ].filter(Boolean);
  const wanUp = on && !!data.wanUp;
  const wanStatus = !on
    ? t('widget.offline')
    : data.wanUp === undefined
      ? t('widget.noWan')
      : [data.wanUp ? t('widget.wanUp') : t('widget.wanDown'), data.wanProto ? protoLabel(data.wanProto, lang) : '']
          .filter(Boolean)
          .join(' · ');
  return {
    empty: false,
    title: data.name,
    online: on,
    status: on ? t('widget.online') : t('widget.offline'),
    updated: refreshing ? t('widget.refreshing') : t('widget.updated', { time: hhmm(data.updatedAt) }),
    time: refreshing ? '…' : hhmm(data.updatedAt),
    refreshable: !!data.refreshable,
    refreshing,
    devicesCount: on && data.devicesOnline !== undefined ? String(data.devicesOnline) : '—',
    devices: on && data.devicesOnline !== undefined ? t('widget.devices', { count: data.devicesOnline }) : '—',
    devicesSplit: on ? split.join(' · ') : '',
    deviceNames: on ? (data.deviceNames ?? []) : [],
    down: rate(data.rxBps),
    up: rate(data.txBps),
    cpu: on && data.cpu !== undefined ? gauge(data.cpu) : undefined,
    memory: on && data.memory !== undefined ? gauge(data.memory) : undefined,
    temperature: on && data.temperature !== undefined ? `${data.temperature.toFixed(1)} °C` : undefined,
    uptime:
      on && data.uptimeSec !== undefined ? t('widget.uptime', { time: formatDuration(data.uptimeSec, lang) }) : undefined,
    wanUp,
    wanStatus,
    wanIp: wanUp ? (data.wanIp ?? '') : '',
    labels,
  };
}
