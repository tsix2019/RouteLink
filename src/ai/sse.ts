/** One Server-Sent Event: the `event:` field (or "message") and its `data:` lines joined by newlines. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental SSE parser (WHATWG rules): any of CRLF, LF or CR end a line, `data:` lines accumulate, a blank
 * line dispatches, `:` lines are comments (keep-alives), a leading BOM is dropped, one space after the colon is
 * not part of the value. Feed it text as it arrives; `end()` flushes an event the stream did not finish.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private started = false;

  push(text: string): SseEvent[] {
    this.buffer += text;
    if (!this.started && this.buffer) {
      this.started = true;
      if (this.buffer.startsWith('﻿')) this.buffer = this.buffer.slice(1);
    }
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.buffer);
      if (!m) break;
      // A CR at the very end may be the first half of a CRLF still on its way.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      this.line(line, out);
    }
    return out;
  }

  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buffer) this.line(this.buffer.replace(/\r$/, ''), out);
    this.buffer = '';
    this.line('', out);
    return out;
  }

  private line(line: string, out: SseEvent[]) {
    if (line === '') {
      if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n') });
      this.event = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
  }
}

/** Reads a streamed response body as SSE events; UTF-8 sequences split between chunks are put back together. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
    yield* parser.end();
  } finally {
    reader.releaseLock();
  }
}
