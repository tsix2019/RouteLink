import type { History, Summary } from '@/api/services/agent';
import type { AppT } from '@/i18n';

/** Excel only reads a CSV as UTF-8 (Chinese device names) when it starts with a byte order mark. */
const BOM = '\uFEFF';
const EOL = '\r\n';

/** RFC 4180: quote fields with commas, quotes or line breaks; double the quotes inside. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (fields: (string | number | null | undefined)[]) => fields.map(csvField).join(',') + EOL;

/** "2026-10-05 13:47" in the given IANA time zone (the phone's). */
export function formatCsvTime(epochSec: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSec * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** One row per device: name (or MAC), MAC, bytes down, up and total, and the period it covers. */
export function summaryCsv(
  t: AppT,
  s: Summary,
  names: Map<string, string>,
  range: { start: number; end: number },
  timeZone: string,
): string {
  const from = formatCsvTime(Math.max(range.start, s.startExact), timeZone);
  const to = formatCsvTime(range.end, timeZone);
  let out =
    BOM +
    row([
      t('traffic:csv.device'),
      t('traffic:csv.mac'),
      t('traffic:csv.rx'),
      t('traffic:csv.tx'),
      t('traffic:csv.total'),
      t('traffic:csv.from'),
      t('traffic:csv.to'),
    ]);
  for (const d of s.devices) out += row([names.get(d.mac) ?? d.mac, d.mac, d.rx, d.tx, d.rx + d.tx, from, to]);
  return out;
}

/** One row per point; steps without data stay empty rather than reading as zero. */
export function historyCsv(t: AppT, h: History, timeZone: string): string {
  let out = BOM + row([t('traffic:csv.time'), t('traffic:csv.rx'), t('traffic:csv.tx')]);
  for (const p of h.points) out += row([formatCsvTime(p.t, timeZone), p.rx, p.tx]);
  return out;
}
