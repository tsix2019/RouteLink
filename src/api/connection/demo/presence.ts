import { hash01 } from './random';
import type { DemoState } from './state';

/** Time of day and who is home: shared by the demo plugin's traffic and Wi-Fi models. */

export const MINUTE = 60;
export const HOUR = 3_600;
export const DAY = 86_400;
/** The demo router lives in Asia/Shanghai (uci system zonename). */
export const TZ_OFFSET = 8 * HOUR;

/** Laptops and computers sleep at night: offline from about 00:30 to 08:30 local time. */
export const SLEEPERS = new Set(['MacBook-Air', 'Desk-PC', 'ThinkPad', 'iPad']);
/** The two devices the demo lists as offline went away this long ago. */
export const OFFLINE_FOR = 2 * HOUR + 53 * MINUTE;

export const localHour = (t: number) => Math.floor((t + TZ_OFFSET) / HOUR) % 24;
export const localDay = (t: number) => Math.floor((t + TZ_OFFSET) / DAY);
export const localMidnight = (t: number) => localDay(t) * DAY - TZ_OFFSET;

export interface Ctx {
  state: DemoState;
  /** Epoch seconds */
  now: number;
}

export function sleepWindow(i: number, day: number): [number, number] {
  return [30 * MINUTE + hash01(i, day, 17) * 40 * MINUTE, 8 * HOUR + hash01(i, day, 19) * 50 * MINUTE];
}

/** Whether device `i` is connected at `t` (sleeping laptops, the devices shown as offline). */
export function present(ctx: Ctx, i: number, t: number): boolean {
  const d = ctx.state.devices[i];
  if (!d.online && t >= ctx.now - OFFLINE_FOR) return false;
  if (SLEEPERS.has(d.hostname)) {
    const [sleep, wake] = sleepWindow(i, localDay(t));
    const sinceMidnight = t - localMidnight(t);
    if (sinceMidnight >= sleep && sinceMidnight < wake) return false;
  }
  return true;
}
