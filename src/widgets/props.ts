import type { AppT } from '@/i18n';
import { formatBitRate } from '@/utils/format';

/**
 * What the home-screen widget shows (design §19), as ready-made text: the iOS widget runs in an isolated
 * runtime that cannot format anything itself, and the Android one is drawn from these in the background.
 */
export interface WidgetProps {
  title: string;
  online: boolean;
  status: string;
  devices: string;
  down: string;
  up: string;
  updated: string;
}

export interface WidgetInput {
  name: string;
  online: boolean;
  devicesOnline?: number;
  rxBps?: number;
  txBps?: number;
  /** When the data was read, ms. */
  updatedAt: number;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function widgetProps(t: AppT, i: WidgetInput): WidgetProps {
  return {
    title: i.name,
    online: i.online,
    status: i.online ? t('widget.online') : t('widget.offline'),
    devices: i.devicesOnline === undefined ? '—' : t('widget.devices', { count: i.devicesOnline }),
    down: i.online && i.rxBps !== undefined ? `↓ ${formatBitRate(i.rxBps)}` : '',
    up: i.online && i.txBps !== undefined ? `↑ ${formatBitRate(i.txBps)}` : '',
    updated: t('widget.updated', { time: hhmm(i.updatedAt) }),
  };
}

/** Before any router has been read. */
export const emptyWidget = (t: AppT): WidgetProps => ({
  title: 'RouteLink',
  online: false,
  status: t('widget.noRouter'),
  devices: '—',
  down: '',
  up: '',
  updated: '',
});
