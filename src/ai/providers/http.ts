import { AiError, type AiErrorKind, type Fetch } from '../types';

function kindOf(status: number, text: string): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || /balance|quota|billing|credit|spend/i.test(text)) return 'quota';
  if (status === 429) return 'rate';
  if (status === 503 || status === 529 || /overload/i.test(text)) return 'overloaded';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad-request';
  return 'other';
}

/** The provider's own error message out of a failed response (both APIs nest it under `error`). */
export async function httpError(res: Response): Promise<AiError> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string; type?: string } | string; message?: string };
    const error = body.error;
    message = (typeof error === 'string' ? error : error?.message) ?? body.message ?? message;
  } catch {
    // not JSON
  }
  return new AiError(kindOf(res.status, message), message, res.status);
}

/** fetch, with failures turned into AiError; an abort stays an AbortError for the caller. */
export async function send(fetch: Fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
    throw new AiError('network', error instanceof Error ? error.message : String(error));
  }
  if (!res.ok) throw await httpError(res);
  return res;
}

/** Tool input arrives as JSON text in pieces; an empty one means no arguments. */
export function parseInput(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    // Invalid arguments: the tool layer rejects the call (it never runs a write with them).
    return { __invalid: json };
  }
}

export const trimSlash = (url: string) => url.replace(/\/+$/, '');
