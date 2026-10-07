import type { Conversation } from '@/state/assistant';

export type HistorySection = 'today' | 'yesterday' | 'week' | 'month' | 'older';

const DAY = 86_400_000;

/** Today and yesterday by the calendar; then the last 7 and 30 days, counted from today's start. */
export function sectionOf(time: number, now: number): HistorySection {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  if (time >= today) return 'today';
  if (time >= today - DAY) return 'yesterday';
  if (time >= today - 6 * DAY) return 'week';
  if (time >= today - 29 * DAY) return 'month';
  return 'older';
}

const matches = (c: Conversation, query: string) =>
  c.title.toLowerCase().includes(query) || c.messages.some((m) => m.text.toLowerCase().includes(query));

/** One router's conversations, newest first, under date headings; a query keeps the ones that mention it. */
export function groupHistory(
  conversations: Conversation[],
  now: number,
  query = '',
): { section: HistorySection; items: Conversation[] }[] {
  const q = query.trim().toLowerCase();
  const groups: { section: HistorySection; items: Conversation[] }[] = [];
  for (const c of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (q && !matches(c, q)) continue;
    const section = sectionOf(c.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last?.section === section) last.items.push(c);
    else groups.push({ section, items: [c] });
  }
  return groups;
}
