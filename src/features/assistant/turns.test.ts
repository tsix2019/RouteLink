import type { ChatMessage } from '@/ai/types';

import { answerOf, lastQuestion, toolResults, toTurns } from './turns';

const call = (id: string, name = 'get_overview') => ({ id, name, input: {} });

describe('conversation turns', () => {
  const messages: ChatMessage[] = [
    { role: 'user', text: '路由器怎么样？' },
    { role: 'assistant', text: '我看一下。', calls: [call('a')] },
    { role: 'user', text: '', results: [{ id: 'a', content: '{}' }] },
    { role: 'assistant', text: '', calls: [call('b', 'read_log'), call('c', 'list_connections')] },
    {
      role: 'user',
      text: '',
      results: [
        { id: 'b', content: '[]' },
        { id: 'c', content: 'no', isError: true },
      ],
    },
    { role: 'assistant', text: '一切正常。', calls: [] },
    { role: 'user', text: '这个月花了多少流量' },
    { role: 'assistant', text: '查不到月度总量。', calls: [] },
  ];

  it('puts each question with what was said and done to answer it; tool steps in a row fold together', () => {
    const turns = toTurns(messages);
    expect(turns.map((t) => [t.key, t.question])).toEqual([
      [0, '路由器怎么样？'],
      [6, '这个月花了多少流量'],
    ]);
    expect(turns[0].parts).toEqual([
      { kind: 'text', text: '我看一下。' },
      { kind: 'tools', calls: [call('a'), call('b', 'read_log'), call('c', 'list_connections')] },
      { kind: 'text', text: '一切正常。' },
    ]);
    expect(answerOf(turns[0])).toBe('我看一下。\n\n一切正常。');
  });

  it('finds the tool results and the last question', () => {
    expect(toolResults(messages).get('c')).toEqual({ id: 'c', content: 'no', isError: true });
    expect(lastQuestion(messages)).toEqual({ index: 6, text: '这个月花了多少流量' });
    expect(lastQuestion([])).toBeNull();
  });

  it('starts a turn for an answer without a question before it', () => {
    expect(toTurns([{ role: 'assistant', text: 'hi', calls: [] }])).toEqual([
      { key: 0, question: null, parts: [{ kind: 'text', text: 'hi' }] },
    ]);
  });
});
