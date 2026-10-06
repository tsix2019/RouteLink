// A stand-in AI provider for trying the assistant on an emulator without a real API key (M4 T11). It speaks
// both Anthropic Messages and OpenAI Chat Completions with streaming and tool calls:
//   npx tsx scripts/mock-llm.ts [port]      (default 18900; the Android emulator reaches it at 10.0.2.2)
// In the app: AI assistant settings → "Other OpenAI-compatible API", address http://10.0.2.2:18900/v1, any model.
// A question asks for one tool (reboot_router for "reboot"/"重启", list_devices for "device"/"设备",
// get_overview otherwise); the answer that follows quotes the tool result, so the round trip is visible.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.argv[2] ?? 18900);

type Msg = { role: string; content: unknown; tool_calls?: unknown };

const pick = (question: string) =>
  /reboot|重启/i.test(question)
    ? 'reboot_router'
    : /device|设备|在线/i.test(question)
      ? 'list_devices'
      : 'get_overview';

/** The last user text and, when the last message carries tool results, the first of them. */
function inspect(messages: Msg[], anthropic: boolean): { question: string; result?: string } {
  const last = messages[messages.length - 1];
  if (anthropic) {
    const blocks = Array.isArray(last?.content) ? (last.content as Record<string, unknown>[]) : [];
    const result = blocks.find((b) => b.type === 'tool_result');
    const text = blocks.find((b) => b.type === 'text')?.text ?? (typeof last?.content === 'string' ? last.content : '');
    return result ? { question: '', result: String(result.content) } : { question: String(text) };
  }
  if (last?.role === 'tool') return { question: '', result: String(last.content) };
  return { question: String(last?.content ?? '') };
}

const answerFor = (result: string) =>
  result.includes('declined')
    ? 'OK, nothing changed. 好的，没有改动。'
    : `Mock answer from the tool result (${result.length} bytes):\n\n\`\`\`\n${result.slice(0, 240)}\n\`\`\``;

function sse(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' });
  return (data: string) => res.write(data);
}

async function chunks(text: string, write: (piece: string) => void) {
  for (const piece of text.match(/[\s\S]{1,5}/g) ?? []) {
    write(piece);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function anthropic(body: { messages: Msg[] }, res: ServerResponse) {
  const send = sse(res);
  const event = (type: string, data: object) => send(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const { question, result } = inspect(body.messages, true);
  event('message_start', { message: { id: 'msg_mock', role: 'assistant', content: [], usage: { input_tokens: 1 } } });
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  await chunks(result !== undefined ? answerFor(result) : 'Let me check. 我查一下。', (text) =>
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
  );
  event('content_block_stop', { index: 0 });
  if (result === undefined) {
    event('content_block_start', {
      index: 1,
      content_block: { type: 'tool_use', id: `toolu_${Date.now()}`, name: pick(question), input: {} },
    });
    event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } });
    event('content_block_stop', { index: 1 });
  }
  event('message_delta', { delta: { stop_reason: result === undefined ? 'tool_use' : 'end_turn' } });
  event('message_stop', {});
  res.end();
}

async function openai(body: { messages: Msg[] }, res: ServerResponse) {
  const send = sse(res);
  const chunk = (delta: object, finish: string | null = null) =>
    send(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const { question, result } = inspect(body.messages, false);
  await chunks(result !== undefined ? answerFor(result) : 'Let me check. 我查一下。', (content) => chunk({ content }));
  if (result === undefined) {
    chunk({
      tool_calls: [
        { index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: pick(question), arguments: '' } },
      ],
    });
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] });
    chunk({}, 'tool_calls');
  } else chunk({}, 'stop');
  send('data: [DONE]\n\n');
  res.end();
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c)).on('end', () => resolve(data));
  });

createServer(async (req, res) => {
  const url = req.url ?? '';
  console.log(req.method, url, req.headers['x-api-key'] ? 'x-api-key' : (req.headers.authorization ?? '').slice(0, 12));
  if (req.method === 'GET' && url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-1' }, { id: 'mock-2' }] }));
    return;
  }
  const body = JSON.parse((await read(req)) || '{}') as { messages: Msg[] };
  if (url === '/v1/messages') return anthropic(body, res);
  if (url === '/v1/chat/completions') return openai(body, res);
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `no route ${url}` } }));
}).listen(port, '0.0.0.0', () => console.log(`mock LLM on http://0.0.0.0:${port}`));
