import type { ChatMessage, ToolCall, ToolResult } from '@/ai/types';

/** What the assistant said or did, in order: text, and the tools it used between two pieces of text. */
export type Part = { kind: 'text'; text: string } | { kind: 'tools'; calls: ToolCall[] };

/** One question and everything the assistant did to answer it. */
export interface Turn {
  /** Index of the question in the messages: stable while the conversation grows. */
  key: number;
  question: string | null;
  parts: Part[];
}

/** The conversation as the screen shows it: tool results are not messages of their own. */
export function toTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      if (m.text) turns.push({ key: i, question: m.text, parts: [] });
      return;
    }
    let turn = turns[turns.length - 1];
    if (!turn) {
      turn = { key: i, question: null, parts: [] };
      turns.push(turn);
    }
    const last = turn.parts[turn.parts.length - 1];
    if (m.text) {
      if (last?.kind === 'text') last.text = `${last.text}\n\n${m.text}`;
      else turn.parts.push({ kind: 'text', text: m.text });
    }
    if (m.calls.length) {
      const end = turn.parts[turn.parts.length - 1];
      if (end?.kind === 'tools') end.calls.push(...m.calls);
      else turn.parts.push({ kind: 'tools', calls: [...m.calls] });
    }
  });
  return turns;
}

export function toolResults(messages: ChatMessage[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const m of messages) if (m.role === 'user') for (const r of m.results ?? []) results.set(r.id, r);
  return results;
}

/** The answer's text, as copied. */
export const answerOf = (turn: Turn) =>
  turn.parts
    .filter((p): p is Extract<Part, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n\n');

/** Where the last question starts: answering it again replaces everything from there. */
export function lastQuestion(messages: ChatMessage[]): { index: number; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && m.text) return { index: i, text: m.text };
  }
  return null;
}
