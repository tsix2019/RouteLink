import type { NativeErrorCode } from 'routelink-native';

export type { NativeErrorCode };

const CONNECTIVITY: ReadonlySet<NativeErrorCode> = new Set([
  'ERR_TIMEOUT',
  'ERR_UNREACHABLE',
  'ERR_DNS',
  'ERR_NETWORK',
]);
const KNOWN: ReadonlySet<string> = new Set<NativeErrorCode>([
  'ERR_TIMEOUT',
  'ERR_UNREACHABLE',
  'ERR_DNS',
  'ERR_TLS_UNTRUSTED',
  'ERR_TLS_PIN_MISMATCH',
  'ERR_NETWORK',
  'ERR_UNSUPPORTED',
  'ERR_INVALID_ARGUMENT',
  'SSH_HOST_KEY_CHANGED',
  'SSH_AUTH_FAILED',
]);

/** Transport-level failure (network, TLS) raised by an HttpClient. */
export class NativeError extends Error {
  constructor(
    readonly code: NativeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NativeError';
  }

  isConnectivity(): boolean {
    return CONNECTIVITY.has(this.code);
  }
}

/** Converts errors rejected by the native module (they carry `code`) into NativeError. */
export function toNativeError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && KNOWN.has(code)) {
    return new NativeError(code as NativeErrorCode, (error as Error).message ?? code);
  }
  return error;
}

export const isConnectivityError = (error: unknown): boolean => error instanceof NativeError && error.isConnectivity();
