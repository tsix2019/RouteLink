import { anthropicProvider, ANTHROPIC_MODELS, ANTHROPIC_URL } from './providers/anthropic';
import { openAiProvider } from './providers/openai';
import type { Fetch, Provider } from './types';

export type PresetId = 'anthropic' | 'openai' | 'deepseek' | 'qwen-intl' | 'qwen-cn' | 'ollama' | 'custom';

export interface Preset {
  id: PresetId;
  kind: 'anthropic' | 'openai';
  baseUrl: string;
  /** Suggested models, the default first; the server's own list (test connection) can add more. */
  models: string[];
  /** Body fields for the suggested models: tools need these models' thinking switched off. */
  extra?: Record<string, unknown>;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** The base URL is the user's to fill in or change. */
  editableUrl: boolean;
  needsKey: boolean;
}

/** Design §18 presets, checked against each provider's docs on 2026-10-06 (M4 plan §1). */
export const PRESETS: Preset[] = [
  {
    id: 'anthropic',
    kind: 'anthropic',
    baseUrl: ANTHROPIC_URL,
    models: ANTHROPIC_MODELS,
    editableUrl: false,
    needsKey: true,
  },
  {
    id: 'openai',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-6-luna', 'gpt-5.6-terra'],
    extra: { reasoning_effort: 'none' },
    editableUrl: false,
    needsKey: true,
  },
  {
    id: 'deepseek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    extra: { thinking: { type: 'disabled' } },
    maxTokensField: 'max_tokens',
    editableUrl: false,
    needsKey: true,
  },
  {
    id: 'qwen-intl',
    kind: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.7-plus', 'qwen3.8-max'],
    extra: { enable_thinking: false },
    maxTokensField: 'max_tokens',
    editableUrl: false,
    needsKey: true,
  },
  {
    id: 'qwen-cn',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.7-plus', 'qwen3.8-max'],
    extra: { enable_thinking: false },
    maxTokensField: 'max_tokens',
    editableUrl: false,
    needsKey: true,
  },
  {
    id: 'ollama',
    kind: 'openai',
    baseUrl: 'http://192.168.1.10:11434/v1',
    models: [],
    editableUrl: true,
    needsKey: false,
  },
  { id: 'custom', kind: 'openai', baseUrl: '', models: [], editableUrl: true, needsKey: false },
];

export const presetOf = (id: PresetId): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export interface ProviderSettings {
  preset: PresetId;
  /** Used where the preset lets the user set it (Ollama, custom). */
  baseUrl: string;
  model: string;
}

export function makeProvider(s: ProviderSettings, apiKey: string, fetch: Fetch): Provider {
  const preset = presetOf(s.preset);
  const model = s.model || preset.models[0] || '';
  if (preset.kind === 'anthropic') return anthropicProvider({ apiKey, model, fetch });
  return openAiProvider({
    apiKey,
    model,
    baseUrl: preset.editableUrl ? s.baseUrl || preset.baseUrl : preset.baseUrl,
    // Only for the models the preset knows: another model may reject the field.
    extra: preset.extra && preset.models.includes(model) ? preset.extra : undefined,
    maxTokensField: preset.maxTokensField,
    fetch,
  });
}
