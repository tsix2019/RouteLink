import { lossPct, type LatencyHistory, type OutageLog, type ProbeTarget } from '@/api/services/agent-diag';
import { csvField, formatCsvTime } from '@/features/traffic/csv';
import type { AppLanguage, AppT } from '@/i18n';
import { formatClock, formatDayTime } from '@/utils/dates';
import { formatDuration } from '@/utils/format';

import { round1 } from './present';

/**
 * Outage log and latency as evidence for the provider (DG-3, design §18.3): CSV files and a plain-text
 * summary for the share sheet. Times are in the phone's time zone like the traffic export.
 */

const BOM = '\uFEFF';
const EOL = '\r\n';
const row = (fields: (string | number | null | undefined)[]) => fields.map(csvField).join(',') + EOL;

export const msText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${round1(v)} ms`);
export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${round1(v)}%`);
/** 99.95 → "99.95%": availability needs two decimals to say anything. */
export const availabilityText = (v: number | null) =>
  v === null ? '—' : `${v >= 99.995 && v < 100 ? '99.99' : Number(v.toFixed(2))}%`;

/** The end of an outage: just the clock time when it ended on the day it started. */
export const outageEnd = (o: { start: number; end: number }, lang: AppLanguage) =>
  new Date(o.start * 1000).toDateString() === new Date(o.end * 1000).toDateString()
    ? formatClock(o.end)
    : formatDayTime(o.end, lang);

export const targetLabel = (t: AppT, target: ProbeTarget) => t(`diagnostics:latency.kind.${target.kind}`);

/** One row per outage: start, end (empty while ongoing), seconds, cause. */
export function outagesCsv(t: AppT, log: OutageLog): string {
  let out =
    BOM +
    row([
      t('diagnostics:latency.csv.start'),
      t('diagnostics:latency.csv.end'),
      t('diagnostics:latency.csv.duration'),
      t('diagnostics:latency.csv.cause'),
    ]);
  for (const o of log.outages) {
    out += row([
      formatCsvTime(o.start),
      o.ongoing ? t('diagnostics:latency.csv.ongoing') : formatCsvTime(o.end),
      o.duration,
      t(`diagnostics:latency.cause.${o.cause}`),
    ]);
  }
  return out;
}

/** One row per target and point; points without data stay empty rather than reading as zero. */
export function latencyCsv(t: AppT, h: LatencyHistory): string {
  let out =
    BOM +
    row([
      t('diagnostics:latency.csv.time'),
      t('diagnostics:latency.csv.target'),
      t('diagnostics:latency.csv.avg'),
      t('diagnostics:latency.csv.max'),
      t('diagnostics:latency.csv.loss'),
    ]);
  for (const s of h.series) {
    const ip = h.targets.find((x) => x.id === s.target)?.ip ?? String(s.target);
    for (const p of s.points) out += row([formatCsvTime(p.t), ip, p.avg, p.max, p.loss]);
  }
  return out;
}

/** "routelink-outages-2026-10-05.csv" (the range's start, phone time zone). */
export function exportFileName(kind: 'outages' | 'latency', start: number): string {
  return `routelink-${kind}-${formatCsvTime(start).slice(0, 10)}.csv`;
}

/** The summary people paste into a complaint: availability, per-target figures and every outage. */
export function latencyText(
  t: AppT,
  lang: AppLanguage,
  d: { router: string; range: string; log: OutageLog; history?: LatencyHistory },
): string {
  const lines = [
    t('diagnostics:latency.text.header', { router: d.router, range: d.range }),
    t('diagnostics:latency.text.stats', {
      availability: availabilityText(d.log.availability),
      n: d.log.count,
      downtime: formatDuration(d.log.totalSec, lang),
    }),
  ];
  for (const s of d.history?.summary ?? []) {
    const target = d.history!.targets.find((x) => x.id === s.target);
    if (!target) continue;
    lines.push(
      t('diagnostics:latency.text.target', {
        ip: target.ip,
        kind: targetLabel(t, target),
        stats: t('diagnostics:latency.targetStats', {
          avg: msText(s.avgMs),
          max: msText(s.maxMs),
          loss: pctText(lossPct(s)),
        }),
      }),
    );
  }
  lines.push('');
  if (!d.log.outages.length) lines.push(t('diagnostics:latency.text.none'));
  else {
    lines.push(t('diagnostics:latency.text.outagesTitle'));
    for (const o of d.log.outages) {
      lines.push(
        t('diagnostics:latency.text.outage', {
          start: formatDayTime(o.start, lang, { year: true }),
          end: o.ongoing ? t('diagnostics:latency.ongoing') : outageEnd(o, lang),
          duration: formatDuration(o.duration, lang),
          cause: t(`diagnostics:latency.cause.${o.cause}`),
        }),
      );
    }
  }
  return lines.join('\n');
}
