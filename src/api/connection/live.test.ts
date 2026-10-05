import { NativeError } from '../http/errors';
import { FakeHttpClient, ubusEndpoint } from '../http/fake';
import { AuthError, ProtocolError, UbusError } from '../ubus/errors';
import { cgiCommand, LiveConnection } from './live';
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

  it('continues its session at a new address without logging in again', async () => {
    const http = new FakeHttpClient()
      .on('POST http://192.168.1.1/ubus', endpoint)
      .on('POST http://192.168.8.1/ubus', endpoint);
    const conn = new LiveConnection({ routerId: 'r1', baseUrl: '192.168.1.1', username: 'root', password: 'p', http });
    await conn.call('system', 'board');
    const moved = conn.relocated('http://192.168.8.1');
    await expect(moved.call('system', 'board')).resolves.toEqual({ model: 'OpenWrt One' });
    const last = http.requests[http.requests.length - 1];
    expect(last.url).toBe('http://192.168.8.1/ubus');
    expect(JSON.parse(last.body!).params[0]).toBe('S');
    expect(http.requests.filter((r) => r.body?.includes('"login"'))).toHaveLength(1);
  });

  it('pins the certificate when a fingerprint is stored', async () => {
    const http = new FakeHttpClient().on('POST https://r/ubus', endpoint);
    const sha = 'ab'.repeat(32);
    const conn = new LiveConnection({
      routerId: 'r1',
      baseUrl: 'https://r',
      username: 'root',
      password: 'p',
      tlsSha256: sha,
      http,
    });
    await conn.call('system', 'board');
    expect(http.requests.every((r) => r.tls?.mode === 'pinned')).toBe(true);
  });

  it('reports the login mode it detected', async () => {
    const http = new FakeHttpClient().on('POST http://r/ubus', endpoint);
    const onLogin = jest.fn();
    const conn = new LiveConnection({
      routerId: 'r1',
      baseUrl: 'http://r',
      username: 'root',
      password: 'p',
      http,
      onLogin,
    });
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

describe('cgiExec', () => {
  const BS = String.fromCharCode(92);
  let logins = 0;
  const login = ubusEndpoint({
    'session.login': () => [0, { ubus_rpc_session: `S${++logins}`, expires: 300 }],
    'system.board': () => [0, {}],
  });
  const text = (status: number, body: string) => ({ status, headers: {}, body });
  const make = (http: FakeHttpClient) =>
    new LiveConnection({ routerId: 'r', baseUrl: 'http://r', username: 'root', password: 'p', http });
  beforeEach(() => {
    logins = 0;
  });

  it('escapes whitespace and backslashes like LuCI and sends the session id', () => {
    expect(cgiCommand(['/usr/bin/x', 'two words', `a${BS}b`])).toBe(`/usr/bin/x two${BS} words a${BS}${BS}b`);
  });

  it('posts the command with the session and returns stdout', async () => {
    const http = new FakeHttpClient()
      .on('POST http://r/ubus', login)
      .on('POST http://r/cgi-bin/cgi-exec', text(200, '{ "code": 0 }\n'));
    await expect(make(http).cgiExec(['/usr/libexec/opkg-call', 'install', '/tmp/upload.ipk'])).resolves.toBe(
      '{ "code": 0 }\n',
    );
    const req = http.requests.find((r) => r.url.endsWith('/cgi-exec'))!;
    expect(req.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(req.body).get('sessionid')).toBe('S1');
    expect(new URLSearchParams(req.body).get('command')).toBe('/usr/libexec/opkg-call install /tmp/upload.ipk');
  });

  it('logs in again once when the session expired', async () => {
    const http = new FakeHttpClient()
      .on('POST http://r/ubus', login)
      .on('POST http://r/cgi-bin/cgi-exec', text(403, 'Exec permission denied\n'), 1)
      .on('POST http://r/cgi-bin/cgi-exec', text(200, 'ok'));
    await expect(make(http).cgiExec(['/bin/true'])).resolves.toBe('ok');
    const sids = http.requests
      .filter((r) => r.url.endsWith('/cgi-exec'))
      .map((r) => new URLSearchParams(r.body).get('sessionid'));
    expect(sids).toEqual(['S1', 'S2']);
  });

  it('reports an ACL denial as missing permission', async () => {
    const http = new FakeHttpClient()
      .on('POST http://r/ubus', login)
      .on('POST http://r/cgi-bin/cgi-exec', text(403, 'Access to command denied by ACL\n'));
    await expect(make(http).cgiExec(['/bin/cat', '/etc/shadow'])).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(logins).toBe(1);
  });

  it('reads a file through cgi-download, and tells a missing file from a refused one', async () => {
    const http = new FakeHttpClient()
      .on('POST http://r/ubus', login)
      .on('POST http://r/cgi-bin/cgi-download', text(200, '{ "adblock_status": "enabled" }'), 1)
      .on('POST http://r/cgi-bin/cgi-download', text(404, 'File not found'), 1)
      .on('POST http://r/cgi-bin/cgi-download', text(403, 'Access to path denied by ACL'));
    const conn = make(http);
    await expect(conn.cgiRead('/var/run/adb_runtime.json')).resolves.toBe('{ "adblock_status": "enabled" }');
    const form = new URLSearchParams(http.requests.find((r) => r.url.endsWith('/cgi-download'))!.body);
    expect([form.get('sessionid'), form.get('path'), form.get('filename')]).toEqual([
      'S1',
      '/var/run/adb_runtime.json',
      'adb_runtime.json',
    ]);
    await expect(conn.cgiRead('/tmp/none')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(conn.cgiRead('/etc/shadow')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('downloads the backup as bytes, asking for a base64 body', async () => {
    const archive = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 255]);
    const http = new FakeHttpClient()
      .on('POST http://r/ubus', login)
      .on('POST http://r/cgi-bin/cgi-backup', text(200, Buffer.from(archive).toString('base64')));
    expect(await make(http).downloadBackup()).toEqual(archive);
    const req = http.requests.find((r) => r.url.endsWith('/cgi-backup'))!;
    expect(req.responseEncoding).toBe('base64');
    expect(new URLSearchParams(req.body).get('sessionid')).toBe('S1');
  });

  it('reads an ACL denial from a base64 error page', async () => {
    const http = new FakeHttpClient()
      .on('POST http://r/ubus', login)
      .on(
        'POST http://r/cgi-bin/cgi-backup',
        text(403, Buffer.from('Access to path denied by ACL').toString('base64')),
      );
    await expect(make(http).downloadBackup()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(logins).toBe(1);
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
    expect(classifyError(new UbusError('PERMISSION_DENIED', 'file.exec'))).toEqual({
      kind: 'permission',
      call: 'file.exec',
    });
  });

  it('marks failures that retrying cannot fix', () => {
    expect(isPermanentFailure({ kind: 'auth' })).toBe(true);
    expect(isPermanentFailure({ kind: 'offline' })).toBe(false);
  });
});
