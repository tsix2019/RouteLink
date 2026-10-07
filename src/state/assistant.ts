import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { presetOf, type PresetId, type ProviderSettings } from '@/ai/presets';
import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import { DEFAULT_PRIVACY, type Privacy } from '@/ai/redact';
import type { ChatMessage } from '@/ai/types';

import { kvStorage } from './storage';

/** One conversation with the assistant (design §18): kept on the phone, about the router it was held with. */
export interface Conversation {
  id: string;
  routerId: string;
  /** The first question, or the name the user gave it. */
  title: string;
  messages: ChatMessage[];
  /** Device codes handed to the AI in this conversation ("d3" → MAC). */
  refs: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

interface AssistantData {
  provider: ProviderSettings;
  privacy: Privacy;
  /** The user has read what is sent and agreed. */
  consented: boolean;
  /** By id. */
  conversations: Record<string, Conversation>;
}

interface AssistantState extends AssistantData {
  hydrated: boolean;
  /**
   * The conversation each router's assistant shows, by router id; none is a new one. Not saved: the
   * assistant starts a new conversation after a restart, and the old ones wait in the history.
   */
  current: Record<string, string>;
  setProvider(patch: Partial<ProviderSettings>): void;
  setPrivacy(patch: Partial<Privacy>): void;
  consent(): void;
  /** Stores a conversation's messages; a new one is named after its first question. */
  save(c: { id: string; routerId: string; messages: ChatMessage[]; refs: Record<string, string> }): void;
  open(routerId: string, id: string | null): void;
  rename(id: string, title: string): void;
  remove(id: string): void;
  /** One router's conversations, or every one. */
  clear(routerId?: string): void;
}

/** Messages kept per conversation: enough to read back, small enough for the key-value store. */
const KEEP = 60;
/** Conversations kept per router; the ones untouched longest go first. */
export const KEEP_CONVERSATIONS = 50;
const TITLE_LENGTH = 60;

export const apiKeyName = (preset: PresetId) => `ai.${preset}.api-key`;
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const getApiKey = (preset: PresetId) => SecureStore.getItemAsync(apiKeyName(preset));
export async function setApiKey(preset: PresetId, key: string | null) {
  if (key) await SecureStore.setItemAsync(apiKeyName(preset), key.trim(), SECURE);
  else await SecureStore.deleteItemAsync(apiKeyName(preset));
}

export const newConversationId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The first question on one line, cut to a title's length. */
export function titleOf(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.text.trim());
  const line = first ? first.text.replace(/\s+/g, ' ').trim() : '';
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

/** Version 1 kept one conversation per router, keyed by the router's id. */
type V1Conversations = Record<string, { messages?: ChatMessage[]; refs?: Record<string, string>; updatedAt?: number }>;

function fromV1(old: V1Conversations) {
  const conversations: Record<string, Conversation> = {};
  for (const [routerId, c] of Object.entries(old)) {
    if (!c.messages?.length) continue;
    const id = newConversationId();
    const time = c.updatedAt ?? Date.now();
    conversations[id] = {
      id,
      routerId,
      title: titleOf(c.messages),
      messages: c.messages,
      refs: c.refs ?? {},
      createdAt: time,
      updatedAt: time,
    };
  }
  return conversations;
}

export const useAssistant = create<AssistantState>()(
  persist(
    (set) => ({
      provider: { preset: 'anthropic', baseUrl: '', model: presetOf('anthropic').models[0] },
      privacy: DEFAULT_PRIVACY,
      consented: false,
      conversations: {},
      current: {},
      hydrated: false,
      setProvider: (patch) =>
        set((s) => {
          const next = { ...s.provider, ...patch };
          // A new preset starts from its own default model and address.
          if (patch.preset && patch.preset !== s.provider.preset && patch.model === undefined) {
            next.model = presetOf(patch.preset).models[0] ?? '';
            next.baseUrl = presetOf(patch.preset).editableUrl ? presetOf(patch.preset).baseUrl : '';
          }
          return { provider: next };
        }),
      setPrivacy: (patch) => set((s) => ({ privacy: { ...s.privacy, ...patch } })),
      consent: () => set({ consented: true }),
      save: ({ id, routerId, messages, refs }) =>
        set((s) => {
          const now = Date.now();
          const before = s.conversations[id];
          const conversations = {
            ...s.conversations,
            [id]: {
              id,
              routerId,
              title: before?.title || titleOf(messages),
              // Provider blocks (thinking) only matter inside a turn; a saved conversation is between turns.
              messages: messages
                .slice(-KEEP)
                .map((m) => (m.role === 'assistant' ? { role: m.role, text: m.text, calls: m.calls } : m)),
              refs,
              createdAt: before?.createdAt ?? now,
              updatedAt: now,
            },
          };
          const mine = Object.values(conversations)
            .filter((c) => c.routerId === routerId)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          for (const old of mine.slice(KEEP_CONVERSATIONS)) delete conversations[old.id];
          return { conversations };
        }),
      open: (routerId, id) =>
        set((s) => {
          const { [routerId]: _old, ...rest } = s.current;
          return { current: id ? { ...rest, [routerId]: id } : rest };
        }),
      rename: (id, title) =>
        set((s) => {
          const c = s.conversations[id];
          const name = title.replace(/\s+/g, ' ').trim();
          if (!c || !name) return {};
          return { conversations: { ...s.conversations, [id]: { ...c, title: name } } };
        }),
      remove: (id) =>
        set((s) => {
          const { [id]: _gone, ...conversations } = s.conversations;
          const current = Object.fromEntries(Object.entries(s.current).filter(([, open]) => open !== id));
          return { conversations, current };
        }),
      clear: (routerId) =>
        set((s) => {
          if (!routerId) return { conversations: {}, current: {} };
          const conversations = Object.fromEntries(
            Object.entries(s.conversations).filter(([, c]) => c.routerId !== routerId),
          );
          const { [routerId]: _open, ...current } = s.current;
          return { conversations, current };
        }),
    }),
    {
      name: 'routelink.assistant',
      version: 2,
      storage: kvStorage,
      partialize: ({ provider, privacy, consented, conversations }) => ({
        provider,
        privacy,
        consented,
        // The demo router's conversations reset with the app, like every other change in demo mode.
        conversations: Object.fromEntries(
          Object.entries(conversations).filter(([, c]) => c.routerId !== DEMO_ROUTER_ID),
        ),
      }),
      migrate: (persisted, version) => {
        const state = persisted as Omit<AssistantData, 'conversations'> & { conversations?: unknown };
        if (version < 2) return { ...state, conversations: fromV1((state.conversations ?? {}) as V1Conversations) };
        return state as AssistantData;
      },
      onRehydrateStorage: () => () => useAssistant.setState({ hydrated: true }),
    },
  ),
);
