import type { AppT } from '@/i18n';
import { formatBitRate } from '@/utils/format';

import type { WidgetData } from './data';

/**
 * What the iOS widget shows (design §19), as ready-made text: it runs in an isolated runtime that cannot
 * format anything itself. Android's widgets format WidgetData themselves (view.ts).
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

export type WidgetInput = WidgetData;

export const hhmm = (ms: number) => {
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
