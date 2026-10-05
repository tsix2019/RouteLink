import { NativeError } from '../http/errors';
import { AuthError, ProtocolError, UbusError } from '../ubus/errors';
import type { CallOptions } from '../ubus/session';
import type { UbusCall, UbusResult } from '../ubus/types';

export type { CallOptions };

/** What every service function talks to. Implemented by LiveConnection (real router) and DemoConnection. */
export interface RouterConnection {
  readonly routerId: string;
  readonly kind: 'live' | 'demo';
  call<T>(object: string, method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T>;
  batch(calls: UbusCall[], options?: CallOptions): Promise<UbusResult[]>;
  /** Cheap reachability probe without credentials. */
  ping(): Promise<boolean>;
  /** Same router, own fresh login: isolates staged uci changes (see stageAndApply). */
  fork?(): RouterConnection;
  /**
   * Runs a command through LuCI's /cgi-bin/cgi-exec with this session and returns its stdout. Same ACL as
   * ubus `file exec`, but it does not hang when the command reloads rpcd (package installs do).
   */
  cgiExec?(argv: string[], options?: { timeoutMs?: number }): Promise<string>;
}

export type ConnectionFailure =
  | { kind: 'offline' }
  | { kind: 'auth' }
  | { kind: 'not-openwrt' }
  | { kind: 'tls-untrusted' }
  | { kind: 'tls-mismatch' }
  | { kind: 'permission'; call?: string }
  | { kind: 'protocol'; status: number }
  | { kind: 'unknown'; message: string };

/** Maps any error thrown by the connection stack to something the UI can act on. */
export function classifyError(error: unknown): ConnectionFailure {
  if (error instanceof NativeError) {
    if (error.code === 'ERR_TLS_UNTRUSTED') return { kind: 'tls-untrusted' };
    if (error.code === 'ERR_TLS_PIN_MISMATCH') return { kind: 'tls-mismatch' };
    if (error.isConnectivity()) return { kind: 'offline' };
    return { kind: 'unknown', message: error.message };
  }
  if (error instanceof AuthError) {
    return error.code === 'BAD_CREDENTIALS' ? { kind: 'auth' } : { kind: 'not-openwrt' };
  }
  if (error instanceof UbusError) {
    if (error.code === 'PERMISSION_DENIED') return { kind: 'permission', call: error.call };
    if (error.code === 'ACCESS_DENIED') return { kind: 'auth' };
    return { kind: 'unknown', message: error.message };
  }
  if (error instanceof ProtocolError) return { kind: 'protocol', status: error.status };
  return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) };
}

/** Errors that retrying will not fix. */
export const isPermanentFailure = (failure: ConnectionFailure): boolean =>
  ['auth', 'not-openwrt', 'tls-untrusted', 'tls-mismatch', 'permission'].includes(failure.kind);
