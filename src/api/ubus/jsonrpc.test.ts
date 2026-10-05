import { UbusError } from './errors';
import { decodeCallResponse, encodeCall, parseJson } from './jsonrpc';
import { NULL_SESSION, callKey } from './types';

describe('encodeCall', () => {
  it('orders params as [sid, object, method, args]', () => {
    expect(encodeCall(3, 'abc', { object: 'system', method: 'board' })).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'call',
      params: ['abc', 'system', 'board', {}],
    });
  });

  it('passes call arguments through', () => {
    const msg = encodeCall(1, NULL_SESSION, { object: 'session', method: 'login', params: { username: 'root' } });
    expect(msg.params).toEqual([NULL_SESSION, 'session', 'login', { username: 'root' }]);
  });
});

describe('decodeCallResponse', () => {
  it('returns data for status 0', () => {
    expect(decodeCallResponse({ result: [0, { a: 1 }] }, 'x.y')).toEqual({ ok: true, data: { a: 1 } });
  });

  it('returns an empty object when status 0 has no payload', () => {
    expect(decodeCallResponse({ result: [0] }, 'x.y')).toEqual({ ok: true, data: {} });
  });

  it.each([
    [1, 'INVALID_COMMAND'],
    [2, 'INVALID_ARGUMENT'],
    [3, 'METHOD_NOT_FOUND'],
    [4, 'NOT_FOUND'],
    [5, 'NO_DATA'],
    [6, 'PERMISSION_DENIED'],
    [7, 'TIMEOUT'],
    [8, 'NOT_SUPPORTED'],
    [9, 'UNKNOWN'],
    [10, 'CONNECTION_FAILED'],
    [42, 'UNKNOWN'],
  ])('maps ubus status %d to %s', (status, code) => {
    const r = decodeCallResponse({ result: [status] }, 'x.y');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe(code);
    expect(!r.ok && r.error.call).toBe('x.y');
  });

  it.each([
    [-32002, 'ACCESS_DENIED'],
    // uhttpd-mod-ubus: the object is not registered (e.g. a daemon that is not running)
    [-32000, 'NOT_FOUND'],
    [-32700, 'PARSE_ERROR'],
    [-32600, 'INVALID_REQUEST'],
    [-32601, 'METHOD_NOT_FOUND'],
    [-32602, 'INVALID_PARAMS'],
    [-1, 'UNKNOWN'],
  ])('maps JSON-RPC error %d to %s', (code, expected) => {
    const r = decodeCallResponse({ error: { code, message: 'm' } }, 'x.y');
    expect(!r.ok && r.error).toBeInstanceOf(UbusError);
    expect(!r.ok && r.error.code).toBe(expected);
  });

  it('treats malformed responses as UNKNOWN', () => {
    for (const bad of [{ foo: 1 }, { result: 'x' }, null, { result: [] }]) {
      const r = decodeCallResponse(bad, 'x.y');
      expect(!r.ok && r.error.code).toBe('UNKNOWN');
    }
  });
});

describe('parseJson', () => {
  it('parses JSON and rejects HTML', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJson('<html></html>')).toThrow(/not JSON/);
  });
});

it('builds call keys', () => {
  expect(callKey({ object: 'luci-rpc', method: 'getDHCPLeases' })).toBe('luci-rpc.getDHCPLeases');
});
