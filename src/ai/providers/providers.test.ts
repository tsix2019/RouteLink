import { makeProvider } from '../presets';
import { AiError, type ChatMessage, type Fetch, type StreamEvent } from '../types';
import { anthropicProvider, toAnthropicMessages } from './anthropic';
import { openAiProvider, toOpenAiMessages } from './openai';

/** A fetch answering with an SSE body cut into small chunks, recording the request. */
function sseFetch(events: string[], status = 200) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    requests.push({ url, init });
    const text = events.join('');
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    return new Response(status === 200 ? body : text, { status });
  };
  return { fetch, requests, body: (i = 0) => JSON.parse(String(requests[i].init.body)) as Record<string, unknown> };
}

const anthropicEvent = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const openAiChunk = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

async function collect(gen: AsyncGenerator<StreamEvent>) {
  let text = '';
  let done: Extract<StreamEvent, { type: 'done' }> | undefined;
  for await (const e of gen) {
    if (e.type === 'text') text += e.text;
    else done = e;
  }
  return { text, done: done! };
}

const request = (messages: ChatMessage[] = [{ role: 'user', text: '谁在线？' }]) => ({
  system: 'You manage an OpenWrt router.',
  messages,
  tools: [{ name: 'list_devices', description: 'Devices', parameters: { type: 'object', properties: {} } }],
});

describe('Anthropic', () => {
  const stream = [
    anthropicEvent('message_start', { message: { id: 'msg_1', usage: { input_tokens: 10 } } }),
    anthropicEvent('content_block_start', {
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    }),
    anthropicEvent('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig==' } }),
    anthropicEvent('content_block_stop', { index: 0 }),
    anthropicEvent('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
    anthropicEvent('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '我查一下' } }),
    anthropicEvent('ping', {}),
    anthropicEvent('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '设备。' } }),
    anthropicEvent('content_block_start', {
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_devices', input: {} },
    }),
    anthropicEvent('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '{"onl' } }),
    anthropicEvent('content_block_delta', {
      index: 2,
      delta: { type: 'input_json_delta', partial_json: 'ine":true}' },
    }),
    anthropicEvent('content_block_stop', { index: 2 }),
    anthropicEvent('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }),
    anthropicEvent('message_stop', {}),
  ];

  it('streams text, assembles the tool call and keeps the blocks to send back', async () => {
    const f = sseFetch(stream);
    const p = anthropicProvider({ apiKey: 'sk-ant', model: 'claude-sonnet-5-5', fetch: f.fetch });
    const { text, done } = await collect(p.stream(request()));
    expect(text).toBe('我查一下设备。');
    expect(done.stop).toBe('tool_use');
    expect(done.calls).toEqual([{ id: 'toolu_1', name: 'list_devices', input: { online: true } }]);
    expect((done.raw as { type: string }[]).map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);

    expect(f.requests[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(f.requests[0].init.headers).toMatchObject({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' });
    const body = f.body();
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', stream: true, system: 'You manage an OpenWrt router.' });
    expect(body.tools).toEqual([
      { name: 'list_devices', description: 'Devices', input_schema: request().tools[0].parameters },
    ]);
    // Nothing the 5.5 models reject.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('sends thinking back inside the tool loop only, results first in the user message', () => {
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig==' },
      { type: 'tool_use', id: 't2', name: 'x', input: {} },
    ];
    const messages: ChatMessage[] = [
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: 'old answer', calls: [], raw: [{ type: 'thinking', signature: 'old' }] },
      { role: 'user', text: 'second question' },
      { role: 'assistant', text: '', calls: [{ id: 't2', name: 'x', input: {} }], raw },
      { role: 'user', text: '', results: [{ id: 't2', content: 'declined', isError: true }] },
    ];
    const out = toAnthropicMessages(messages);
    expect(out[1].content).toEqual([{ type: 'text', text: 'old answer' }]);
    expect(out[3].content).toBe(raw);
    expect(out[4].content).toEqual([{ type: 'tool_result', tool_use_id: 't2', content: 'declined', is_error: true }]);
  });

  it('turns HTTP and in-stream errors into AiError kinds', async () => {
    const auth = sseFetch(
      [JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })],
      401,
    );
    await expect(
      collect(anthropicProvider({ apiKey: 'bad', model: 'm', fetch: auth.fetch }).stream(request())),
    ).rejects.toMatchObject({
      kind: 'auth',
      message: 'invalid x-api-key',
    });
    const overloaded = sseFetch([
      anthropicEvent('message_start', {}),
      anthropicEvent('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ]);
    await expect(
      collect(anthropicProvider({ apiKey: 'k', model: 'm', fetch: overloaded.fetch }).stream(request())),
    ).rejects.toMatchObject({ kind: 'overloaded' });
    const cut = sseFetch(stream.slice(0, 6));
    await expect(
      collect(anthropicProvider({ apiKey: 'k', model: 'm', fetch: cut.fetch }).stream(request())),
    ).rejects.toBeInstanceOf(AiError);
  });
});

describe('OpenAI-compatible', () => {
  it('assembles tool calls from pieces, whatever the server sends with them', async () => {
    const f = sseFetch([
      openAiChunk({
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        obfuscation: 'x',
      }),
      openAiChunk({ choices: [{ index: 0, delta: { reasoning_content: '…' } }] }),
      openAiChunk({ choices: [{ index: 0, delta: { content: '好的，' } }] }),
      openAiChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'list_devices', arguments: '' } },
              ],
            },
          },
        ],
      }),
      // Qwen repeats an empty id on continuations.
      openAiChunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: '', function: { arguments: '{"online"' } }] } }],
      }),
      openAiChunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':true}' } }] } }],
      }),
      openAiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      openAiChunk({ choices: [], usage: { total_tokens: 9 } }),
      'data: [DONE]\n\n',
    ]);
    const p = openAiProvider({
      apiKey: 'sk',
      baseUrl: 'https://api.deepseek.com/',
      model: 'deepseek-flash',
      fetch: f.fetch,
    });
    const { text, done } = await collect(p.stream(request()));
    expect(text).toBe('好的，');
    expect(done).toEqual({
      type: 'done',
      stop: 'tool_use',
      calls: [{ id: 'call_1', name: 'list_devices', input: { online: true } }],
    });
    expect(f.requests[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect(f.requests[0].init.headers).toMatchObject({ authorization: 'Bearer sk' });
  });

  it('takes a whole call in one chunk (Ollama) and a stream without [DONE]', async () => {
    const f = sseFetch([
      openAiChunk({
        choices: [
          { index: 0, delta: { tool_calls: [{ id: 'c9', function: { name: 'get_overview', arguments: '{}' } }] } },
        ],
      }),
      openAiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    const p = openAiProvider({
      apiKey: '',
      baseUrl: 'http://192.168.1.10:11434/v1',
      model: 'qwen3:8b',
      fetch: f.fetch,
    });
    const { done } = await collect(p.stream(request()));
    expect(done.calls).toEqual([{ id: 'c9', name: 'get_overview', input: {} }]);
  });

  it('writes the conversation as Chat Completions messages', () => {
    expect(
      toOpenAiMessages('sys', [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'reboot_router', input: {} }] },
        { role: 'user', text: '', results: [{ id: 'c1', content: 'The user declined.', isError: true }] },
      ]),
    ).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reboot_router', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'The user declined.' },
    ]);
  });
});

describe('presets', () => {
  it('switches thinking off for the models a preset knows, and nothing for others', async () => {
    const f = sseFetch(['data: [DONE]\n\n']);
    await collect(
      makeProvider({ preset: 'deepseek', baseUrl: '', model: 'deepseek-flash' }, 'k', f.fetch).stream(request()),
    );
    expect(f.body()).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 8192 });
    const g = sseFetch(['data: [DONE]\n\n']);
    await collect(
      makeProvider({ preset: 'openai', baseUrl: '', model: 'some-other-model' }, 'k', g.fetch).stream(request()),
    );
    expect(g.body()).not.toHaveProperty('reasoning_effort');
    const h = sseFetch(['data: [DONE]\n\n']);
    await collect(
      makeProvider({ preset: 'ollama', baseUrl: 'http://10.0.0.5:11434/v1', model: 'llama' }, '', h.fetch).stream(
        request(),
      ),
    );
    expect(h.requests[0].url).toBe('http://10.0.0.5:11434/v1/chat/completions');
  });
});
