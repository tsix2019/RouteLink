import type { Lang } from './format';

/**
 * Dates in the app's language, independent of the phone's: Hermes formats `toLocaleString(locale)` in the
 * device locale whatever `locale` says, so a Chinese UI on an English phone showed "Oct 5". The app only
 * speaks two languages, so the patterns are spelled out here. Times use the phone's time zone.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface Parts {
  y: number;
  m: number;
  d: number;
  wd: number;
  hh: number;
  mm: number;
  ss: number;
}

/** `utc`: the timestamp already holds a wall time (the router's `localtime`), read it without shifting. */
function parts(epochSec: number, utc = false): Parts {
  const x = new Date(epochSec * 1000);
  return utc
    ? {
        y: x.getUTCFullYear(),
        m: x.getUTCMonth(),
        d: x.getUTCDate(),
        wd: x.getUTCDay(),
        hh: x.getUTCHours(),
        mm: x.getUTCMinutes(),
        ss: x.getUTCSeconds(),
      }
    : {
        y: x.getFullYear(),
        m: x.getMonth(),
        d: x.getDate(),
        wd: x.getDay(),
        hh: x.getHours(),
        mm: x.getMinutes(),
        ss: x.getSeconds(),
      };
}

const two = (n: number) => String(n).padStart(2, '0');

/** "09:07" (or "09:07:05"), 24-hour. */
export function formatClock(epochSec: number, o: { seconds?: boolean; utc?: boolean } = {}): string {
  const p = parts(epochSec, o.utc);
  return `${two(p.hh)}:${two(p.mm)}${o.seconds ? `:${two(p.ss)}` : ''}`;
}

/** "10月5日" / "Oct 5"; with a weekday "10月5日 周一" / "Mon, Oct 5". */
export function formatDay(
  epochSec: number,
  lang: Lang,
  o: { weekday?: boolean; year?: boolean; utc?: boolean } = {},
): string {
  const p = parts(epochSec, o.utc);
  if (lang === 'zh-CN') {
    const day = `${o.year ? `${p.y}年` : ''}${p.m + 1}月${p.d}日`;
    return o.weekday ? `${day} ${WEEKDAYS_ZH[p.wd]}` : day;
  }
  const day = `${MONTHS_SHORT[p.m]} ${p.d}${o.year ? `, ${p.y}` : ''}`;
  return o.weekday ? `${WEEKDAYS_EN[p.wd]}, ${day}` : day;
}

/** "10月5日 09:07" / "Oct 5, 09:07"; with the year "2026年10月5日 09:07" / "Oct 5, 2026, 09:07". */
export function formatDayTime(epochSec: number, lang: Lang, o: { year?: boolean; utc?: boolean } = {}): string {
  const day = formatDay(epochSec, lang, o);
  const time = formatClock(epochSec, { utc: o.utc });
  return lang === 'zh-CN' ? `${day} ${time}` : `${day}, ${time}`;
}

/** "2026年10月5日" / "Oct 5, 2026". */
export const formatDate = (epochSec: number, lang: Lang) => formatDay(epochSec, lang, { year: true });

/** "10/5" (axis labels; the same in both languages). */
export function formatNumericDay(epochSec: number): string {
  const p = parts(epochSec);
  return `${p.m + 1}/${p.d}`;
}

/** "10月" / "Oct". */
export function formatMonth(epochSec: number, lang: Lang): string {
  const p = parts(epochSec);
  return lang === 'zh-CN' ? `${p.m + 1}月` : MONTHS_SHORT[p.m];
}

/** "2026年10月" / "October 2026". */
export function formatMonthYear(epochSec: number, lang: Lang): string {
  const p = parts(epochSec);
  return lang === 'zh-CN' ? `${p.y}年${p.m + 1}月` : `${MONTHS_LONG[p.m]} ${p.y}`;
}
