import type { Conversation } from '@/state/assistant';

import { groupHistory, sectionOf } from './history';

const DAY = 86_400_000;
// 6 October 2026, 15:00 local time.
const now = new Date(2026, 9, 6, 15, 0).getTime();
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

const chat = (id: string, updatedAt: number, title = id, text = ''): Conversation => ({
  id,
  routerId: 'r1',
  title,
  messages: text ? [{ role: 'user', text }] : [],
  refs: {},
  createdAt: updatedAt,
  updatedAt,
});

describe('assistant history', () => {
  it('sorts times into today, yesterday, the last 7 and 30 days, and older', () => {
    expect(sectionOf(at(2026, 9, 6, 0), now)).toBe('today');
    expect(sectionOf(at(2026, 9, 5, 23), now)).toBe('yesterday');
    expect(sectionOf(at(2026, 9, 5, 0), now)).toBe('yesterday');
    expect(sectionOf(at(2026, 9, 4, 23), now)).toBe('week');
    expect(sectionOf(at(2026, 8, 30), now)).toBe('week');
    expect(sectionOf(at(2026, 8, 29), now)).toBe('month');
    expect(sectionOf(now - 40 * DAY, now)).toBe('older');
  });

  it('lists the newest first under their headings', () => {
    const groups = groupHistory(
      [
        chat('old', now - 40 * DAY),
        chat('noon', at(2026, 9, 6)),
        chat('y', at(2026, 9, 5)),
        chat('am', at(2026, 9, 6, 9)),
      ],
      now,
    );
    expect(groups.map((g) => [g.section, g.items.map((c) => c.id)])).toEqual([
      ['today', ['noon', 'am']],
      ['yesterday', ['y']],
      ['older', ['old']],
    ]);
  });

  it('finds conversations by title or by what was said, ignoring case', () => {
    const list = [
      chat('a', now, 'Wi-Fi 信道'),
      chat('b', now - 1, '流量', '这个月 WAN 用了多少'),
      chat('c', now - 2, '重启'),
    ];
    expect(groupHistory(list, now, 'wi-fi')[0].items.map((c) => c.id)).toEqual(['a']);
    expect(groupHistory(list, now, ' wan ')[0].items.map((c) => c.id)).toEqual(['b']);
    expect(groupHistory(list, now, '没有')).toEqual([]);
  });
});
