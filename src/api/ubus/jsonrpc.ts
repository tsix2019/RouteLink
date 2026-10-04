import { ProtocolError, UbusError, fromRpcError, fromStatus } from './errors';
import type { UbusCall, UbusResult } from './types';

export interface JsonRpcCall {
  jsonrpc: '2.0';
  id: number;
  method: 'call';
  params: [string, string, string, Record<string, unknown>];
}

export const encodeCall = (id: number, sid: string, call: UbusCall): JsonRpcCall => ({
  jsonrpc: '2.0',
  id,
  method: 'call',
  params: [sid, call.object, call.method, call.params ?? {}],
});

/** ubus answers `result: [status, data?]` or a JSON-RPC `error` object. */
export function decodeCallResponse<T>(response: unknown, call: string): UbusResult<T> {
  const r = response as { result?: unknown; error?: { code: number; message?: string } } | null;
  if (r?.error) return { ok: false, error: fromRpcError(r.error, call) };
  const result = r?.result;
  if (!Array.isArray(result) || typeof result[0] !== 'number') {
    return { ok: false, error: new UbusError('UNKNOWN', call, 'malformed response') };
  }
  if (result[0] !== 0) return { ok: false, error: fromStatus(result[0], call) };
  return { ok: true, data: (result[1] ?? {}) as T };
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new ProtocolError(200, 'response is not JSON');
  }
}
