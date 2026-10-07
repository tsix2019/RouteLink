import type { WidgetData } from './data';
import { showOnWidget } from './update';

/** iOS gives a widget a few dozen redraws a day: only for something new, or every ten minutes at most. */
const EVERY_MS = 10 * 60_000;

let last: { at: number; key: string } | null = null;

/** The overview's fresh data on the home-screen widgets, sparingly. */
export function updateWidgetFromApp(data: WidgetData, now = Date.now()): boolean {
  // The rates (and the rest) arrive a moment after the first reading: their first value counts as news too.
  const key = [
    data.name,
    data.online,
    data.devicesOnline ?? '',
    data.rxBps !== undefined,
    data.wanUp ?? '',
    data.wanIp ?? '',
    data.cpu !== undefined,
  ].join('|');
  if (last && last.key === key && now - last.at < EVERY_MS) return false;
  last = { at: now, key };
  void showOnWidget(data).catch(() => undefined);
  return true;
}

/** Tests only. */
export const resetWidgetThrottle = () => {
  last = null;
};
