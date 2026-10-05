/**
 * Offset from UTC of a POSIX TZ string (what OpenWrt keeps in uci system.timezone and /etc/TZ), e.g.
 * "CST-8" or "CET-1CEST,M3.5.0,M10.5.0/3". The router's `system info` reports local time only; this turns
 * it back into UTC. Supports the forms OpenWrt's zone list uses: fixed offsets and Mm.w.d rules.
 */

const NAME = /^(?:<[^>]+>|[A-Za-z]{3,})/;
const OFFSET = /^([+-]?)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/;
const RULE = /^M(\d{1,2})\.(\d)\.(\d)(?:\/([+-]?\d{1,3}(?::\d{2}){0,2}))?$/;

/** "+hh[:mm[:ss]]" → seconds. */
function seconds(sign: string, h: string, m?: string, s?: string): number {
  const v = Number(h) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return sign === '-' ? -v : v;
}

/** Seconds since the epoch of day `d` (0 = Sunday) in week `w` (5 = last) of month `m`, 00:00 UTC. */
function ruleDay(year: number, m: number, w: number, d: number): number {
  const first = Date.UTC(year, m - 1, 1);
  const firstDow = new Date(first).getUTCDay();
  let day = 1 + ((d - firstDow + 7) % 7) + (w - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  while (day > daysInMonth) day -= 7;
  return Date.UTC(year, m - 1, day) / 1000;
}

/** Seconds east of UTC in effect at `utcSec`. */
export function posixOffsetAt(tz: string, utcSec: number): number {
  let rest = tz.trim();
  const std = NAME.exec(rest);
  if (!std) return 0;
  rest = rest.slice(std[0].length);
  const stdOff = OFFSET.exec(rest);
  // "UTC" alone: no offset given.
  if (!stdOff) return 0;
  rest = rest.slice(stdOff[0].length);
  // POSIX offsets count west of UTC.
  const standard = -seconds(stdOff[1], stdOff[2], stdOff[3], stdOff[4]) || 0;

  const dst = NAME.exec(rest);
  if (!dst) return standard;
  rest = rest.slice(dst[0].length);
  const dstOff = OFFSET.exec(rest);
  const summer = dstOff ? -seconds(dstOff[1], dstOff[2], dstOff[3], dstOff[4]) || 0 : standard + 3600;
  if (dstOff) rest = rest.slice(dstOff[0].length);

  const [, startText, endText] = rest.split(',');
  const start = RULE.exec(startText ?? '');
  const end = RULE.exec(endText ?? '');
  if (!start || !end) return standard;
  const time = (t: string | undefined) => {
    if (!t) return 7200;
    const [h, m, s] = t.replace(/^[+-]/, '').split(':');
    return seconds(t.startsWith('-') ? '-' : '+', h, m, s);
  };
  const year = new Date((utcSec + standard) * 1000).getUTCFullYear();
  // The change to summer time happens at a standard-time wall clock, the change back at a summer-time one.
  const begins = ruleDay(year, +start[1], +start[2], +start[3]) + time(start[4]) - standard;
  const ends = ruleDay(year, +end[1], +end[2], +end[3]) + time(end[4]) - summer;
  const inSummer = begins < ends ? utcSec >= begins && utcSec < ends : utcSec >= begins || utcSec < ends;
  return inSummer ? summer : standard;
}
