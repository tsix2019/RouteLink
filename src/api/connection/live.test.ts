import { NativeError } from '../http/errors';
import { FakeHttpClient, ubusEndpoint } from '../http/fake';
import { AuthError, ProtocolError, UbusError } from '../ubus/errors';
import { LiveConnection } from './live';
import { classifyError, isPermanentFailure } from './types';

const endpoint = ubusEndpoint({
  'session.login': () => [0, { ubus_rpc_session: 'S', expires: 300 }],
  'system.board': () => [0, { model: 'OpenWrt One' }],
});

describe('LiveConnection', () => {
  it('normalises the address and calls ubus', async () => {
    const http = new FakeHttpClient().on('POST http://192.168.1.1/ubus', endpoint);
    const conn = new LiveConnection({ routerId: 'r1', baseUrl: '192.168.1.1/', username: 'root', password: 'p', http });
    await expect(conn.call('system', 'board')).resolves.toEqual({ model: 'OpenWrt One' });
    expect(conn.baseUrl).toBe('http://192.168.1.1');
  });

  it('pins the certificate when a fingerprint is stored', async () => {
    const http = new FakeHttpClient().on('POST https://r/ubus', endpoint);
    const sha = 'ab'.repeat(32);
    const conn = new LiveConnection({ routerId: 'r1', baseUrl: 'https://r', username: 'root', password: 'p', tlsSha256: sha, http });
    await conn.call('system', 'board');
    expect(http.requests.every((r) => r.tls?.mode === 'pinned')).toBe(true);
  });

  it('reports the login mode it detected', async () => {
    const http = new FakeHttpClient().on('POST http://r/ubus', endpoint);
    const onLogin = jest.fn();
    const conn = new LiveConnection({ routerId: 'r1', baseUrl: 'http://r', username: 'root', password: 'p', http, onLogin });
    await conn.call('system', 'board');
    expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ubus' }));
  });

  it('pings: any HTTP answer is online, connectivity errors are offline', async () => {
    const up = new LiveConnection({
      routerId: 'a',
      baseUrl: 'http://up',
      username: 'root',
      password: '',
      http: new FakeHttpClient().on('GET http://up/', { status: 404, headers: {}, body: '' }),
    });
    const down = new LiveConnection({
      routerId: 'b',
      baseUrl: 'http://down',
      username: 'root',
      password: '',
      http: new FakeHttpClient().on('GET http://down/', new NativeError('ERR_UNREACHABLE', 'refused')),
    });
    await expect(up.ping()).resolves.toBe(true);
    await expect(down.ping()).resolves.toBe(false);
  });
});

describe('classifyError', () => {
  it.each([
    [new NativeError('ERR_TIMEOUT', ''), 'offline'],
    [new NativeError('ERR_UNREACHABLE', ''), 'offline'],
    [new NativeError('ERR_TLS_UNTRUSTED', ''), 'tls-untrusted'],
    [new NativeError('ERR_TLS_PIN_MISMATCH', ''), 'tls-mismatch'],
    [new AuthError('BAD_CREDENTIALS'), 'auth'],
    [new AuthError('NO_ENDPOINT'), 'not-openwrt'],
    [new UbusError('PERMISSION_DENIED', 'file.exec'), 'permission'],
    [new UbusError('ACCESS_DENIED', 'uci.confirm'), 'auth'],
    [new UbusError('NOT_FOUND', 'x.y'), 'unknown'],
    [new ProtocolError(500, 'boom'), 'protocol'],
    [new Error('x'), 'unknown'],
  ])('%p → %s', (error, kind) => {
    expect(classifyError(error).kind).toBe(kind);
  });

  it('keeps the denied call for permission errors', () => {
    expect(classifyError(new UbusError('PERMISSION_DENIED', 'file.exec'))).toEqual({ kind: 'permission', call: 'file.exec' });
  });

  it('marks failures that retrying cannot fix', () => {
    expect(isPermanentFailure({ kind: 'auth' })).toBe(true);
    expect(isPermanentFailure({ kind: 'offline' })).toBe(false);
  });
});
