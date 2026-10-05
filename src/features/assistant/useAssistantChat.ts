import { useRef, useState } from 'react';

import { runTurn, systemPrompt, trimHistory, type Language } from '@/ai/agent';
import { makeProvider, presetOf } from '@/ai/presets';
import { demoProvider } from '@/ai/providers/demo';
import { DeviceRefs, type Tool } from '@/ai/tools';
import { AiError, type ChatMessage, type Fetch, type ToolCall } from '@/ai/types';
import type { RouterConnection } from '@/api/connection/types';
import { getApiKey, useAssistant } from '@/state/assistant';

export interface PendingConfirm {
  call: ToolCall;
  tool: Tool;
}

export type ChatError = { kind: AiError['kind'] | 'no-key'; message: string };

const EMPTY: ChatMessage[] = [];

/**
 * One router's conversation (design §18): the saved history, the turn that is running (its messages so far
 * and the text still streaming), and the write waiting for the user's yes or no.
 */
export function useAssistantChat(o: {
  routerId: string | undefined;
  connection: RouterConnection | null;
  language: Language;
  fetch?: Fetch;
}) {
  const saved = useAssistant((s) => (o.routerId ? s.conversations[o.routerId] : undefined));
  const history = saved?.messages ?? EMPTY;
  const [live, setLive] = useState<ChatMessage[] | null>(null);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = live !== null;

  const send = async (text: string) => {
    const question = text.trim();
    const { connection, routerId } = o;
    if (!question || busy || !connection || !routerId) return;
    setError(null);
    const demo = connection.kind === 'demo';
    const settings = useAssistant.getState();
    const preset = presetOf(settings.provider.preset);
    const key = demo ? '' : ((await getApiKey(preset.id)) ?? '');
    if (!demo && preset.needsKey && !key) {
      setError({ kind: 'no-key', message: '' });
      return;
    }
    const provider = demo
      ? demoProvider(o.language)
      : makeProvider(settings.provider, key, o.fetch ?? ((url, init) => fetch(url, init)));
    const refs = new DeviceRefs({ ...(settings.conversations[routerId]?.refs ?? {}) });
    const controller = new AbortController();
    abort.current = controller;
    setLive([{ role: 'user', text: question }]);
    setStreaming('');
    const outcome = await runTurn({
      provider,
      system: systemPrompt(o.language),
      history: trimHistory(settings.conversations[routerId]?.messages ?? []),
      text: question,
      ctx: { conn: connection, privacy: settings.privacy, refs },
      signal: controller.signal,
      callbacks: {
        onText: (delta) => setStreaming((s) => s + delta),
        onMessages: (added) => {
          setLive(added);
          setStreaming('');
        },
        onToolCall: () => undefined,
        onToolResult: () => undefined,
        confirm: (call, tool) =>
          new Promise<boolean>((resolve) => {
            answer.current = resolve;
            setPending({ call, tool });
            controller.signal.addEventListener('abort', () => resolve(false), { once: true });
          }),
      },
    });
    const all = [...(useAssistant.getState().conversations[routerId]?.messages ?? []), ...outcome.messages];
    useAssistant.getState().save(routerId, { messages: all, refs: refs.toJSON() });
    if (outcome.error) {
      const e = outcome.error;
      setError(e instanceof AiError ? { kind: e.kind, message: e.message } : { kind: 'other', message: String(e) });
    }
    abort.current = null;
    answer.current = null;
    setPending(null);
    setStreaming('');
    setLive(null);
  };

  return {
    /** Saved history plus what the running turn has added. */
    messages: live ? [...history, ...live] : history,
    /** Text of the answer still arriving. */
    streaming,
    busy,
    pending,
    error,
    send: (text: string) => void send(text),
    decide: (yes: boolean) => {
      setPending(null);
      answer.current?.(yes);
      answer.current = null;
    },
    stop: () => abort.current?.abort(),
    clear: () => {
      if (o.routerId) useAssistant.getState().clear(o.routerId);
      setError(null);
    },
  };
}
