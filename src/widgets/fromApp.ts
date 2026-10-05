import type { AppT } from '@/i18n';

import { widgetProps, type WidgetInput } from './props';
import { showOnWidget } from './update';

/** iOS gives a widget a few dozen redraws a day: only for something new, or every ten minutes at most. */
const EVERY_MS = 10 * 60_000;

let last: { at: number; key: string } | null = null;

/** The overview's fresh data on the home-screen widget, sparingly. */
export function updateWidgetFromApp(t: AppT, input: WidgetInput, now = Date.now()): boolean {
  const key = `${input.name}|${input.online}|${input.devicesOnline ?? ''}`;
  if (last && last.key === key && now - last.at < EVERY_MS) return false;
  last = { at: now, key };
  void showOnWidget(widgetProps(t, input)).catch(() => undefined);
  return true;
}

/** Tests only. */
export const resetWidgetThrottle = () => {
  last = null;
};
