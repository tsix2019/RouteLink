/** The assistant's own conversation format (design §18); each provider translates it to its API. */

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  /** JSON text, or a sentence when the call failed or the user declined. */
  content: string;
  isError?: boolean;
}

export type ChatMessage =
  | {
      role: 'user';
      text: string;
      /** Answers to the previous assistant message's tool calls, in its order. */
      results?: ToolResult[];
    }
  | {
      role: 'assistant';
      text: string;
      calls: ToolCall[];
      /**
       * The provider's own content blocks, sent back as they came within a tool loop (Anthropic requires its
       * thinking blocks there); dropped once the turn is over.
       */
      raw?: unknown;
    };

/** A tool as providers describe it to the model. */
export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  parameters: Record<string, unknown>;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type StreamEvent =
  { type: 'text'; text: string } | { type: 'done'; stop: StopReason; calls: ToolCall[]; raw?: unknown };

export type AiErrorKind = 'auth' | 'rate' | 'overloaded' | 'quota' | 'bad-request' | 'network' | 'server' | 'other';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface ProviderRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
}

export interface Provider {
  stream(request: ProviderRequest): AsyncGenerator<StreamEvent>;
  /** Model ids the key can use; also how a key is checked. */
  listModels(signal?: AbortSignal): Promise<string[]>;
}

/** The fetch the providers use: global fetch in the app (expo/fetch, streaming), a fake in tests. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
