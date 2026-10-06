import type { LimitRule, QuotaRule, Weekday as RuleDay } from '@/api/services/agent-rules';
import { WEEKDAYS } from '@/api/services/agent-rules';
import { describeDays, describeWindow, type Weekday } from '@/utils/weekly';

/** UCI weekday names ↔ the app's 0 (Sunday) – 6 numbering. */
export const toWeekdays = (days: RuleDay[]): Weekday[] =>
  days.map((d) => ((WEEKDAYS.indexOf(d) + 1) % 7) as Weekday).sort((a, b) => a - b);
export const fromWeekdays = (days: Weekday[]): RuleDay[] =>
  WEEKDAYS.filter((_, i) => days.includes(((i + 1) % 7) as Weekday));

/** "8 Mbps" from kbit/s; 0 = no limit (null). */
export const mbps = (kbps: number): string | null =>
  kbps > 0 ? `${kbps >= 1000 ? Number((kbps / 1000).toFixed(1)) : kbps / 1000} Mbps` : null;

/** When a limit applies: "Weekdays 19:00–22:00", or null for always. */
export function limitWhen(r: Pick<LimitRule, 'weekdays' | 'start' | 'stop'>, lang: 'zh-CN' | 'en'): string | null {
  const days = r.weekdays.length && r.weekdays.length < 7 ? describeDays(toWeekdays(r.weekdays), lang) : null;
  const window = r.start && r.stop ? describeWindow(r.start, r.stop, lang) : null;
  return [days, window].filter(Boolean).join(' ') || null;
}

/** GB with up to one decimal from the rule's MB. */
export const quotaGb = (q: Pick<QuotaRule, 'limitMb'>) => Number((q.limitMb / 1024).toFixed(1));
