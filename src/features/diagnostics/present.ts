import { bandLabel } from '@/features/wireless/labels';
import type { AppLanguage, AppT } from '@/i18n';
import { formatDayTime } from '@/utils/dates';
import { formatDuration, protoLabel } from '@/utils/format';

import { shareText, type SegmentFacts, type SegmentResult } from './diagnose';
import { overall, type Advice, type SegmentId, type SegmentStatus } from './rules';

/**
 * How the one-click diagnosis reads on screen and in the shared text: the facts of each segment as short
 * lines, the headline, and where each piece of advice leads.
 */

/** Screens an advice row opens; the others are plain text. */
export const ADVICE_HREF: Partial<Record<Advice, string>> = {
  'move-closer': '/wireless/tools/signal',
  'optimize-channel': '/wireless/tools/channels',
  'change-dns': '/network/edit/wan',
  'outage-log': '/network/diagnostics/latency',
  'fix-security': '/wireless/tools/security',
};

/** 0.4 → "0.4", 12.5 → "13": one decimal only where it matters. */
export const round1 = (v: number) => (Math.abs(v) < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));

const num = (f: SegmentFacts, key: string): number | undefined =>
  typeof f[key] === 'number' && Number.isFinite(f[key]) ? (f[key] as number) : undefined;
const text = (f: SegmentFacts, key: string): string | undefined =>
  typeof f[key] === 'string' && f[key] ? (f[key] as string) : undefined;
const join = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');

/** The measured facts of a segment as lines for the screen and the shared text. */
export function segmentFacts(t: AppT, lang: AppLanguage, r: SegmentResult, o: { plugin?: boolean } = {}): string[] {
  const f = r.facts;
  const skipped = r.verdict.status === 'skip';
  // A router command (ping, nslookup) that was refused or failed: the check could not be made.
  const notRun = text(f, 'notRun');
  const notRunText = notRun ? t('diagnostics:facts.notRun', { tool: notRun }) : undefined;
  const notRunLine = notRunText ? [notRunText] : [];
  switch (r.segment) {
    case 'phone-wifi': {
      const signal = num(f, 'signal');
      const band = text(f, 'band');
      const rate = num(f, 'rate'); // kbit/s as iwinfo reports it
      const rtt = num(f, 'rttMs');
      const loss = num(f, 'lossPct') ?? 0;
      return [
        signal === undefined
          ? t('diagnostics:facts.phoneUnknown')
          : join([
              t('diagnostics:facts.signal', { dbm: signal }),
              band && bandLabel(t, band as Parameters<typeof bandLabel>[1]),
              rate !== undefined && t('diagnostics:facts.rate', { rate: Math.round(rate / 1000) }),
              text(f, 'ap'),
            ]),
        rtt === undefined
          ? t('diagnostics:facts.rttFail')
          : join([
              t('diagnostics:facts.rtt', { ms: rtt, jitter: num(f, 'jitterMs') ?? 0 }),
              loss > 0 && t('diagnostics:facts.rttLoss', { loss: round1(loss) }),
            ]),
      ];
    }
    case 'ap-uplink': {
      const aps = text(f, 'aps');
      return aps ? [t('diagnostics:facts.apLoss', { list: aps }), ...notRunLine] : [t('diagnostics:facts.noAps')];
    }
    case 'wan': {
      const proto = text(f, 'proto');
      if (!proto) return [t('diagnostics:facts.wanMissing')];
      const uptime = num(f, 'uptimeSec');
      const redials = num(f, 'redials');
      return [
        join([
          protoLabel(proto, lang),
          text(f, 'ip') ?? t('diagnostics:facts.noIp'),
          !!uptime && text(f, 'ip') && t('diagnostics:facts.uptime', { duration: formatDuration(uptime, lang) }),
        ]),
        ...(redials === undefined ? [] : [t('diagnostics:facts.redials', { n: redials })]),
      ];
    }
    case 'upstream': {
      const hop = text(f, 'nexthop');
      if (!hop) return [t('diagnostics:facts.noNexthop')];
      const avg = num(f, 'avgMs');
      return [
        join([
          t('diagnostics:facts.nexthop', { ip: hop }),
          avg !== undefined
            ? t('diagnostics:facts.avg', { ms: round1(avg) })
            : (notRunText ?? (r.verdict.status === 'fail' && t('diagnostics:facts.noReply'))),
        ]),
      ];
    }
    case 'dns':
      return [t('diagnostics:facts.dns', { list: text(f, 'ms') ?? '—' }), ...notRunLine];
    case 'internet': {
      const loss = num(f, 'lossPct');
      const avg = num(f, 'avgMs');
      const http = f.http204;
      return [
        ...(loss === undefined
          ? []
          : [
              join([
                t('diagnostics:facts.publicLoss', { loss: round1(loss) }),
                avg !== undefined && t('diagnostics:facts.avg', { ms: round1(avg) }),
              ]),
            ]),
        ...notRunLine,
        ...(http === true
          ? [t('diagnostics:facts.http204Ok')]
          : http === false
            ? [t('diagnostics:facts.http204Fail')]
            : []),
      ];
    }
    case 'stability': {
      if (skipped) return [o.plugin ? t('diagnostics:facts.noProbeData') : t('diagnostics:facts.needsPlugin')];
      const loss = num(f, 'lossPct');
      return [
        t('diagnostics:facts.recent', { loss: loss === undefined ? '—' : round1(loss), n: num(f, 'outages') ?? 0 }),
      ];
    }
    case 'wifi-security': {
      const level = text(f, 'level');
      return [
        skipped || !level
          ? t('diagnostics:facts.noWifi')
          : t('diagnostics:facts.security', {
              level: t(`diagnostics:level.${level as 'high' | 'medium' | 'low' | 'danger'}`),
            }),
      ];
    }
  }
}

export interface Headline {
  status: SegmentStatus | 'running';
  title: string;
  segment?: SegmentId;
}

/** "The problem is at: …" from the nearest failing (else warning) segment; "Checking…" while running. */
export function headline(t: AppT, results: readonly SegmentResult[], running: boolean): Headline {
  const o = overall(Object.fromEntries(results.map((r) => [r.segment, r.verdict])));
  if (o.segment) {
    const segment = t(`diagnostics:segment.${o.segment}`);
    return {
      status: o.status,
      segment: o.segment,
      title: t(`diagnostics:headline.${o.status as 'warn' | 'fail'}`, { segment }),
    };
  }
  if (running) return { status: 'running', title: t('diagnostics:headline.running') };
  return { status: 'ok', title: t('diagnostics:headline.ok') };
}

/** The whole result as plain text for the share sheet (plan decision 6: text only, no image). */
export function diagnosisText(
  t: AppT,
  lang: AppLanguage,
  d: { router: string; at: number; results: readonly SegmentResult[]; plugin?: boolean },
): string {
  const by = new Map(d.results.map((r) => [r.segment, r]));
  const body = shareText(
    [...d.results],
    (segment) => {
      const label = t(`diagnostics:segment.${segment}`);
      const facts = segmentFacts(t, lang, by.get(segment)!, { plugin: d.plugin });
      return facts.length
        ? t('diagnostics:share.line', { label, facts: facts.join(t('diagnostics:share.separator')) })
        : label;
    },
    (status) => t(`diagnostics:share.status.${status}`),
    (advice) => t(`diagnostics:advice.${advice}`),
  );
  const title = t('diagnostics:share.title', { router: d.router, time: formatDayTime(d.at, lang, { year: true }) });
  return `${title}\n${headline(t, d.results, false).title}\n\n${body}`;
}
