import type { UbusError } from './errors';

/** Session id used for the unauthenticated `session login` call. */
export const NULL_SESSION = '00000000000000000000000000000000';

export interface UbusCall {
  object: string;
  method: string;
  params?: Record<string, unknown>;
}

export type UbusResult<T = unknown> = { ok: true; data: T } | { ok: false; error: UbusError };

export const callKey = (call: UbusCall): string => `${call.object}.${call.method}`;
