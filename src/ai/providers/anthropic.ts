import { readSse } from '../sse';
import {
  AiError,
  type ChatMessage,
  type Fetch,
  type Provider,
  type ProviderRequest,
  type StopReason,
  type StreamEvent,
  type ToolCall,
} from '../types';
import { parseInput, send, trimSlash } from './http';

/** Design §18: Claude by default; Sonnet first, Opus and Haiku to choose from. */
export const ANTHROPIC_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'];
export const ANTHROPIC_URL = 'https://api.anthropic.com';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  fetch: Fetch;
}

type Block = Record<string, unknown> & { type: string };

const STOPS: Record<string, StopReason> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
};

/**
 * The conversation as Messages API content blocks. Tool results lead the user message that answers them.
 * Assistant messages of the turn still in progress go back exactly as they came (thinking blocks included,
 * which the API requires inside a tool loop); earlier ones are rebuilt without them.
 */
export function toAnthropicMessages(messages: ChatMessage[]): { role: string; content: Block[] }[] {
  let turnStart = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user' && m.text) turnStart = i;
  });
  const mapped = messages.map((m, i) => {
    if (m.role === 'user') {
      return {
        role: 'user',
        content: [
          ...(m.results ?? []).map((r) => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          })),
          ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ],
      };
    }
    if (i > turnStart && Array.isArray(m.raw) && m.raw.length) return { role: 'assistant', content: m.raw as Block[] };
    const content: Block[] = [
      ...(m.text ? [{ type: 'text', text: m.text }] : []),
      ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
    ];
    return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] };
  });
  // Neighbours of the same role become one message (tool results, then a question after a stopped answer).
  const merged: { role: string; content: Block[] }[] = [];
  for (const m of mapped) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content = [...last.content, ...m.content];
    else merged.push({ ...m });
  }
  return merged;
}

export function anthropicProvider(o: AnthropicOptions): Provider {
  const base = trimSlash(o.baseUrl || ANTHROPIC_URL);
  const headers = {
    'x-api-key': o.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  return {
    async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
      const res = await send(o.fetch, `${base}/v1/messages`, {
        method: 'POST',
        headers: { ...headers, accept: 'text/event-stream' },
        body: JSON.stringify({
          model: o.model,
          max_tokens: o.maxTokens ?? 8192,
          system: req.system,
          messages: toAnthropicMessages(req.messages),
          ...(req.tools.length
            ? {
                tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
              }
            : {}),
          stream: true,
        }),
        signal: req.signal,
      });
      if (!res.body) throw new AiError('network', 'no response body');

      const blocks: Block[] = [];
      const json: string[] = [];
      let stop: StopReason = 'other';
      let finished = false;
      for await (const e of readSse(res.body)) {
        let d: { type?: string; index?: number; content_block?: Block; delta?: Record<string, string> };
        try {
          d = JSON.parse(e.data);
        } catch {
          continue;
        }
        const i = d.index ?? 0;
        switch (d.type) {
          case 'content_block_start':
            blocks[i] = { ...(d.content_block as Block) };
            json[i] = '';
            break;
          case 'content_block_delta': {
            const delta = d.delta ?? {};
            const block = blocks[i];
            if (!block) break;
            if (delta.type === 'text_delta') {
              block.text = `${String(block.text ?? '')}${delta.text}`;
              yield { type: 'text', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              json[i] += delta.partial_json ?? '';
            } else if (delta.type === 'thinking_delta') {
              block.thinking = `${String(block.thinking ?? '')}${delta.thinking}`;
            } else if (delta.type === 'signature_delta') {
              block.signature = `${String(block.signature ?? '')}${delta.signature}`;
            }
            break;
          }
          case 'message_delta':
            stop = STOPS[String(d.delta?.stop_reason)] ?? 'other';
            break;
          case 'message_stop':
            finished = true;
            break;
          case 'error': {
            const error = (d as { error?: { type?: string; message?: string } }).error;
            const overloaded = error?.type === 'overloaded_error';
            throw new AiError(overloaded ? 'overloaded' : 'server', error?.message ?? 'stream error');
          }
        }
      }
      if (!finished) throw new AiError('network', 'the answer was cut off');

      const calls: ToolCall[] = [];
      blocks.forEach((b, i) => {
        if (b?.type !== 'tool_use') return;
        const input = json[i] ? parseInput(json[i]) : ((b.input as Record<string, unknown>) ?? {});
        b.input = input;
        calls.push({ id: String(b.id), name: String(b.name), input });
      });
      yield { type: 'done', stop, calls, raw: blocks.filter(Boolean) };
    },

    async listModels(signal) {
      const res = await send(o.fetch, `${base}/v1/models?limit=100`, { method: 'GET', headers, signal });
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => m.id);
    },
  };
}
