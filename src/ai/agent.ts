import { runTool, toolByName, TOOLS, type Tool, type ToolContext } from './tools';
import type { ChatMessage, Provider, StopReason, ToolCall, ToolResult } from './types';

export type Language = 'zh-CN' | 'en';

/** Fixed for a whole conversation (the Anthropic API rejects replayed thinking once the system prompt changes). */
export function systemPrompt(language: Language): string {
  return [
    'You are the assistant inside RouteLink, a phone app that manages an OpenWrt router.',
    `Answer in ${language === 'zh-CN' ? 'Simplified Chinese' : 'English'} unless the user writes in another language.`,
    'Be brief: short paragraphs or lists, plain words, numbers with units.',
    'Look things up with the tools instead of guessing. Devices are named by codes such as "d3" from list_devices; never invent a code.',
    'Tools that change the router show the user a confirmation in the app before they run. Use them only when the user asks for the change, and say what it will do and what it may interrupt.',
    'You cannot upgrade firmware, restore a backup, reset the router or change VLANs: point the user to those pages in the app.',
    'Some fields may be missing or masked because the user keeps them private; do not ask for them. Never ask for passwords or keys.',
  ].join('\n');
}

export interface TurnCallbacks {
  onText(delta: string): void;
  /** A call is about to run (reads) or to ask the user (writes). */
  onToolCall(call: ToolCall, tool: Tool | undefined): void;
  onToolResult(call: ToolCall, result: ToolResult): void;
  /** Writes wait for this; false declines. */
  confirm(call: ToolCall, tool: Tool): Promise<boolean>;
  /** What the turn has added so far, after each step (for showing it while it runs). */
  onMessages?(added: ChatMessage[]): void;
}

export interface TurnOptions {
  provider: Provider;
  system: string;
  history: ChatMessage[];
  text: string;
  ctx: ToolContext;
  signal: AbortSignal;
  callbacks: TurnCallbacks;
  /** Tool rounds per answer. */
  maxRounds?: number;
}

export interface TurnOutcome {
  /** Everything the turn added, the user's message first; always a valid continuation of the history. */
  messages: ChatMessage[];
  stop: StopReason | 'rounds' | 'stopped';
  error?: unknown;
}

const STOPPED = 'The user stopped the answer before this ran.';
const DECLINED = 'The user declined this action.';

/**
 * One answer (design §18): stream the reply, run read tools at once, ask before every write, feed the results
 * back, until the model answers without tools or the round limit is hit. A stop or an error ends the turn but
 * still leaves a history the next question can build on (every tool call gets its result).
 */
export async function runTurn(o: TurnOptions): Promise<TurnOutcome> {
  const added: ChatMessage[] = [{ role: 'user', text: o.text }];
  o.callbacks.onMessages?.([...added]);
  const tools = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
  let text = '';
  try {
    for (let round = 0; round < (o.maxRounds ?? 8); round++) {
      text = '';
      let done: { stop: StopReason; calls: ToolCall[]; raw?: unknown } | undefined;
      for await (const e of o.provider.stream({
        system: o.system,
        messages: [...o.history, ...added],
        tools,
        signal: o.signal,
      })) {
        if (e.type === 'text') {
          text += e.text;
          o.callbacks.onText(e.text);
        } else done = e;
      }
      if (!done) throw new Error('no answer');
      added.push({ role: 'assistant', text, calls: done.calls, raw: done.raw });
      text = '';
      o.callbacks.onMessages?.([...added]);
      if (!done.calls.length) return { messages: added, stop: done.stop };

      const results: ToolResult[] = [];
      for (const call of done.calls) {
        const tool = toolByName(call.name);
        o.callbacks.onToolCall(call, tool);
        let result: ToolResult;
        if (o.signal.aborted) result = { id: call.id, content: STOPPED, isError: true };
        else if (!tool) result = { id: call.id, content: `There is no tool named ${call.name}.`, isError: true };
        else if (tool.risk !== 'read' && !(await o.callbacks.confirm(call, tool))) {
          result = { id: call.id, content: DECLINED, isError: true };
        } else if (o.signal.aborted) {
          // Stopped while the confirmation was open: nothing runs.
          result = { id: call.id, content: STOPPED, isError: true };
        } else result = { id: call.id, ...(await runTool(tool, o.ctx, call.input)) };
        o.callbacks.onToolResult(call, result);
        results.push(result);
      }
      added.push({ role: 'user', text: '', results });
      o.callbacks.onMessages?.([...added]);
      if (o.signal.aborted) return { messages: added, stop: 'stopped' };
    }
    return { messages: added, stop: 'rounds' };
  } catch (error) {
    const stopped = o.signal.aborted;
    // Keep what was said so far; a call that never got its result gets one now.
    const last = added[added.length - 1];
    if (last.role === 'assistant' && last.calls.length) {
      added.push({
        role: 'user',
        text: '',
        results: last.calls.map((c) => ({ id: c.id, content: STOPPED, isError: true })),
      });
    }
    if (text) added.push({ role: 'assistant', text, calls: [] });
    return { messages: added, stop: 'stopped', error: stopped ? undefined : error };
  }
}

/** History sent along with the next question: the latest messages, never starting inside a tool exchange. */
export function trimHistory(messages: ChatMessage[], keep = 40): ChatMessage[] {
  if (messages.length <= keep) return messages;
  let start = messages.length - keep;
  while (start < messages.length && !(messages[start].role === 'user' && messages[start].text)) start++;
  return messages.slice(start);
}
