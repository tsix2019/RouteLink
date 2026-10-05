import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { presetOf, type PresetId, type ProviderSettings } from '@/ai/presets';
import { DEMO_ROUTER_ID } from '@/api/connection/demo/connection';
import { DEFAULT_PRIVACY, type Privacy } from '@/ai/redact';
import type { ChatMessage } from '@/ai/types';

import { kvStorage } from './storage';

/** One router's conversation with the assistant (design §18: kept on the phone, per router). */
export interface Conversation {
  messages: ChatMessage[];
  /** Device codes handed to the AI in this conversation ("d3" → MAC). */
  refs: Record<string, string>;
  updatedAt: number;
}

interface AssistantData {
  provider: ProviderSettings;
  privacy: Privacy;
  /** The user has read what is sent and agreed. */
  consented: boolean;
  conversations: Record<string, Conversation>;
}

interface AssistantState extends AssistantData {
  hydrated: boolean;
  setProvider(patch: Partial<ProviderSettings>): void;
  setPrivacy(patch: Partial<Privacy>): void;
  consent(): void;
  save(routerId: string, conversation: Omit<Conversation, 'updatedAt'>): void;
  clear(routerId?: string): void;
}

/** Messages kept per router: enough to read back, small enough for the key-value store. */
const KEEP = 60;

export const apiKeyName = (preset: PresetId) => `ai.${preset}.api-key`;
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const getApiKey = (preset: PresetId) => SecureStore.getItemAsync(apiKeyName(preset));
export async function setApiKey(preset: PresetId, key: string | null) {
  if (key) await SecureStore.setItemAsync(apiKeyName(preset), key.trim(), SECURE);
  else await SecureStore.deleteItemAsync(apiKeyName(preset));
}

export const useAssistant = create<AssistantState>()(
  persist(
    (set) => ({
      provider: { preset: 'anthropic', baseUrl: '', model: presetOf('anthropic').models[0] },
      privacy: DEFAULT_PRIVACY,
      consented: false,
      conversations: {},
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
      save: (routerId, c) =>
        set((s) => ({
          conversations: {
            ...s.conversations,
            [routerId]: {
              // Provider blocks (thinking) only matter inside a turn; a saved conversation is between turns.
              messages: c.messages
                .slice(-KEEP)
                .map((m) => (m.role === 'assistant' ? { role: m.role, text: m.text, calls: m.calls } : m)),
              refs: c.refs,
              updatedAt: Date.now(),
            },
          },
        })),
      clear: (routerId) =>
        set((s) => {
          if (!routerId) return { conversations: {} };
          const { [routerId]: _gone, ...rest } = s.conversations;
          return { conversations: rest };
        }),
    }),
    {
      name: 'routelink.assistant',
      version: 1,
      storage: kvStorage,
      partialize: ({ provider, privacy, consented, conversations }) => {
        // The demo router's conversation resets with the app, like every other change in demo mode.
        const { [DEMO_ROUTER_ID]: _demo, ...kept } = conversations;
        return { provider, privacy, consented, conversations: kept };
      },
      onRehydrateStorage: () => () => useAssistant.setState({ hydrated: true }),
    },
  ),
);
