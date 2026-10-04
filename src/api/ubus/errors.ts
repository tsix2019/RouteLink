export type UbusErrorCode =
  | 'INVALID_COMMAND'
  | 'INVALID_ARGUMENT'
  | 'METHOD_NOT_FOUND'
  | 'NOT_FOUND'
  | 'NO_DATA'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'NOT_SUPPORTED'
  | 'UNKNOWN'
  | 'CONNECTION_FAILED'
  /** JSON-RPC -32002: invalid/expired session, or an ACL denial (UbusSession tells them apart). */
  | 'ACCESS_DENIED'
  | 'PARSE_ERROR'
  | 'INVALID_REQUEST'
  | 'INVALID_PARAMS';

/** ubus status codes (libubus `enum ubus_msg_status`). */
const STATUS: Record<number, UbusErrorCode> = {
  1: 'INVALID_COMMAND',
  2: 'INVALID_ARGUMENT',
  3: 'METHOD_NOT_FOUND',
  4: 'NOT_FOUND',
  5: 'NO_DATA',
  6: 'PERMISSION_DENIED',
  7: 'TIMEOUT',
  8: 'NOT_SUPPORTED',
  9: 'UNKNOWN',
  10: 'CONNECTION_FAILED',
};

const RPC: Record<number, UbusErrorCode> = {
  [-32700]: 'PARSE_ERROR',
  [-32600]: 'INVALID_REQUEST',
  [-32601]: 'METHOD_NOT_FOUND',
  [-32602]: 'INVALID_PARAMS',
  [-32002]: 'ACCESS_DENIED',
};

export class UbusError extends Error {
  constructor(
    readonly code: UbusErrorCode,
    readonly call?: string,
    detail?: string,
  ) {
    super(`${code}${call ? ` ${call}` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'UbusError';
  }
}

export const fromStatus = (status: number, call?: string): UbusError =>
  new UbusError(STATUS[status] ?? 'UNKNOWN', call, `status ${status}`);

export const fromRpcError = (error: { code: number; message?: string }, call?: string): UbusError =>
  new UbusError(RPC[error.code] ?? 'UNKNOWN', call, error.message);

export type AuthErrorCode = 'BAD_CREDENTIALS' | 'NO_ENDPOINT';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

/** The router answered, but not with something we can use (unexpected HTTP status, HTML instead of JSON). */
export class ProtocolError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}
