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

export interface OpenAiOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Preset-specific body fields, e.g. switching a model's thinking off so tools work. */
  extra?: Record<string, unknown>;
  /** The output limit's field name; omitted when the server's default is fine. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  maxTokens?: number;
  fetch: Fetch;
}

const STOPS: Record<string, StopReason> = {
  stop: 'end',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
};

/** The conversation as Chat Completions messages: tool results become `tool` messages before the user's text. */
export function toOpenAiMessages(system: string, messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      for (const r of m.results ?? []) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      if (m.text) out.push({ role: 'user', content: m.text });
    } else {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.calls.length
          ? {
              tool_calls: m.calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    }
  }
  return out;
}

interface Chunk {
  error?: { message?: string };
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string | null;
        function?: { name?: string | null; arguments?: string | null };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

/** Any OpenAI-compatible Chat Completions server: OpenAI, DeepSeek, Qwen, Ollama or one of your own. */
export function openAiProvider(o: OpenAiOptions): Provider {
  const base = trimSlash(o.baseUrl);
  const headers = { authorization: `Bearer ${o.apiKey || 'none'}`, 'content-type': 'application/json' };
  return {
    async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
      const res = await send(o.fetch, `${base}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, accept: 'text/event-stream' },
        body: JSON.stringify({
          model: o.model,
          messages: toOpenAiMessages(req.system, req.messages),
          ...(req.tools.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
          ...(o.maxTokensField ? { [o.maxTokensField]: o.maxTokens ?? 8192 } : {}),
          ...o.extra,
          stream: true,
        }),
        signal: req.signal,
      });
      if (!res.body) throw new AiError('network', 'no response body');

      // Calls arrive in pieces keyed by index; id and name only in some of them.
      const calls: { id: string; name: string; args: string }[] = [];
      let finish: string | null = null;
      let done = false;
      for await (const e of readSse(res.body)) {
        if (e.data === '[DONE]') {
          done = true;
          break;
        }
        let chunk: Chunk;
        try {
          chunk = JSON.parse(e.data);
        } catch {
          continue;
        }
        if (chunk.error) throw new AiError('server', chunk.error.message ?? 'stream error');
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const text = choice.delta?.content;
        if (text) yield { type: 'text', text };
        for (const part of choice.delta?.tool_calls ?? []) {
          const i = part.index ?? 0;
          const call = (calls[i] ??= { id: '', name: '', args: '' });
          if (part.id) call.id = part.id;
          if (part.function?.name) call.name = part.function.name;
          if (part.function?.arguments) call.args += part.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      // Some servers end the stream without [DONE]; a finish reason is enough.
      if (!done && !finish) throw new AiError('network', 'the answer was cut off');

      const toolCalls: ToolCall[] = calls
        .filter((c) => c && c.name)
        .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, input: parseInput(c.args) }));
      const stop: StopReason = toolCalls.length ? 'tool_use' : (STOPS[finish ?? ''] ?? 'end');
      yield { type: 'done', stop, calls: toolCalls };
    },

    async listModels(signal) {
      const res = await send(o.fetch, `${base}/models`, { method: 'GET', headers, signal });
      const body = (await res.json()) as { data?: { id: string }[]; models?: { name: string }[] };
      return [...(body.data ?? []).map((m) => m.id), ...(body.models ?? []).map((m) => m.name)];
    },
  };
}
