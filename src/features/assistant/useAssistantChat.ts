import { useEffect, useRef, useState } from 'react';

import { runTurn, systemPrompt, trimHistory, type Language } from '@/ai/agent';
import { makeProvider, presetOf } from '@/ai/presets';
import { demoProvider } from '@/ai/providers/demo';
import { DeviceRefs, type Tool } from '@/ai/tools';
import { AiError, type ChatMessage, type Fetch, type ToolCall } from '@/ai/types';
import type { RouterConnection } from '@/api/connection/types';
import { getApiKey, newConversationId, useAssistant } from '@/state/assistant';

import { lastQuestion } from './turns';

export interface PendingConfirm {
  call: ToolCall;
  tool: Tool;
}

export type ChatError = { kind: AiError['kind'] | 'no-key'; message: string };

/** The turn that is running: which conversation, what it started from and what it has added so far. */
interface Live {
  id: string;
  base: ChatMessage[];
  added: ChatMessage[];
}

const EMPTY: ChatMessage[] = [];

/**
 * The conversation open for a router (design §18): its saved messages, the turn that is running (its messages so
 * far and the text still streaming), and the write waiting for the user's yes or no. A router has many
 * conversations; switching to another stops the running turn, which still saves into its own.
 */
export function useAssistantChat(o: {
  routerId: string | undefined;
  connection: RouterConnection | null;
  language: Language;
  fetch?: Fetch;
}) {
  const id = useAssistant((s) => (o.routerId ? s.current[o.routerId] : undefined));
  const saved = useAssistant((s) => (id ? s.conversations[id] : undefined));
  const [live, setLive] = useState<Live | null>(null);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = live !== null;
  const shown = live && live.id === id ? live : null;

  // Leaving the screen ends the turn: nobody is left to answer a confirmation.
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (question: string, conversationId: string, base: ChatMessage[]) => {
    const { connection, routerId } = o;
    if (!connection || !routerId) return;
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
    const refs = new DeviceRefs({ ...(settings.conversations[conversationId]?.refs ?? {}) });
    const controller = new AbortController();
    abort.current = controller;
    setLive({ id: conversationId, base, added: [{ role: 'user', text: question }] });
    setStreaming('');
    const outcome = await runTurn({
      provider,
      system: systemPrompt(o.language),
      history: trimHistory(base),
      text: question,
      ctx: { conn: connection, privacy: settings.privacy, refs },
      signal: controller.signal,
      callbacks: {
        onText: (delta) => setStreaming((s) => s + delta),
        onMessages: (added) => {
          setLive({ id: conversationId, base, added });
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
    useAssistant
      .getState()
      .save({ id: conversationId, routerId, messages: [...base, ...outcome.messages], refs: refs.toJSON() });
    if (outcome.error && useAssistant.getState().current[routerId] === conversationId) {
      const e = outcome.error;
      setError(e instanceof AiError ? { kind: e.kind, message: e.message } : { kind: 'other', message: String(e) });
    }
    abort.current = null;
    answer.current = null;
    setPending(null);
    setStreaming('');
    setLive(null);
  };

  const switchTo = (next: string | null) => {
    if (!o.routerId || next === (id ?? null)) return;
    abort.current?.abort();
    setError(null);
    useAssistant.getState().open(o.routerId, next);
  };

  return {
    /** The open conversation; none until the first question of a new one. */
    id,
    title: saved?.title,
    /** Saved messages plus what the running turn has added. */
    messages: shown ? [...shown.base, ...shown.added] : (saved?.messages ?? EMPTY),
    /** Text of the answer still arriving. */
    streaming: shown ? streaming : '',
    /** A turn is running, maybe in a conversation no longer open: new questions wait for it. */
    busy,
    /** The open conversation's turn is running. */
    answering: !!shown,
    pending: shown ? pending : null,
    error,
    send: (text: string) => {
      const question = text.trim();
      if (!question || busy || !o.connection || !o.routerId) return;
      const conversationId = id ?? newConversationId();
      if (!id) useAssistant.getState().open(o.routerId, conversationId);
      void run(question, conversationId, saved?.messages ?? EMPTY);
    },
    /** Answers the last question again, in place of the answer it had. */
    regenerate: () => {
      const last = lastQuestion(saved?.messages ?? EMPTY);
      if (!last || busy || !id || !saved) return;
      void run(last.text, id, saved.messages.slice(0, last.index));
    },
    decide: (yes: boolean) => {
      setPending(null);
      answer.current?.(yes);
      answer.current = null;
    },
    stop: () => abort.current?.abort(),
    newChat: () => switchTo(null),
    open: (conversationId: string) => switchTo(conversationId),
  };
}
