import { readSse, SseParser } from './sse';

describe('SseParser', () => {
  it('dispatches on blank lines, joins data lines and keeps the event name', () => {
    const p = new SseParser();
    expect(p.push('event: message_start\ndata: {"a":1}\n\n')).toEqual([{ event: 'message_start', data: '{"a":1}' }]);
    expect(p.push('data: line one\ndata: line two\n\n')).toEqual([{ event: 'message', data: 'line one\nline two' }]);
  });

  it('copes with CRLF, CR, comments, a BOM and chunks cut anywhere', () => {
    const text = '﻿: keep-alive\r\nevent: ping\r\ndata: {}\r\n\r\ndata: [DONE]\r\r';
    const p = new SseParser();
    // The last CR could still be half of a CRLF: only the end of the stream settles it.
    const events = [...[...text].flatMap((ch) => p.push(ch)), ...p.end()];
    expect(events).toEqual([
      { event: 'ping', data: '{}' },
      { event: 'message', data: '[DONE]' },
    ]);
  });

  it('flushes an event the stream did not finish, and ignores unknown fields', () => {
    const p = new SseParser();
    expect(p.push('id: 7\nretry: 100\ndata:{"x":2}')).toEqual([]);
    expect(p.end()).toEqual([{ event: 'message', data: '{"x":2}' }]);
  });
});

describe('readSse', () => {
  it('reads a byte stream, putting split UTF-8 back together', async () => {
    const bytes = new TextEncoder().encode('data: 你好\n\ndata: 世界\n\n');
    const chunks = [bytes.slice(0, 7), bytes.slice(7, 9), bytes.slice(9)];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const e of readSse(body)) out.push(e.data);
    expect(out).toEqual(['你好', '世界']);
  });
});
