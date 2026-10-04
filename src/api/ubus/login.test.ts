import { FakeHttpClient, json, ubusEndpoint } from '../http/fake';
import { AuthError } from './errors';
import { findSysauth, login, loginLuci, loginUbus } from './login';

const BASE = 'http://192.168.1.1';
const cred = { username: 'root', password: 'secret' };

function ubusLoginOk(sid = 'abc123') {
  return ubusEndpoint({
    'session.login': (params) =>
      params.password === 'secret' ? [0, { ubus_rpc_session: sid, timeout: 300, expires: 300 }] : [6],
  });
}

describe('loginUbus', () => {
  it('returns a ubus session', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/ubus`, ubusLoginOk('s1'));
    const s = await loginUbus({ http, baseUrl: BASE }, cred);
    expect(s).toEqual({ mode: 'ubus', endpoint: `${BASE}/ubus`, sid: 's1', expiresInSec: 300 });
    const sent = JSON.parse(http.requests[0].body!);
    expect(sent.params).toEqual(['00000000000000000000000000000000', 'session', 'login', cred]);
  });

  it('reports bad credentials', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/ubus`, ubusLoginOk());
    await expect(loginUbus({ http, baseUrl: BASE }, { ...cred, password: 'wrong' })).rejects.toMatchObject({
      code: 'BAD_CREDENTIALS',
    });
  });

  it('treats 404 and HTML answers as a missing endpoint', async () => {
    for (const res of [
      { status: 404, headers: {}, body: '' },
      { status: 200, headers: {}, body: '<html>LuCI</html>' },
    ]) {
      const http = new FakeHttpClient().on(`POST ${BASE}/ubus`, res);
      await expect(loginUbus({ http, baseUrl: BASE }, cred)).rejects.toMatchObject({ code: 'NO_ENDPOINT' });
    }
  });
});

describe('loginLuci', () => {
  it('uses the sysauth cookie as the session', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/cgi-bin/luci/`, {
      status: 302,
      headers: { 'set-cookie': ['sysauth_http=abc; path=/cgi-bin/luci/; HttpOnly'], location: ['/cgi-bin/luci/'] },
      body: '',
    });
    const s = await loginLuci({ http, baseUrl: BASE }, cred);
    expect(s).toEqual({
      mode: 'luci',
      endpoint: `${BASE}/cgi-bin/luci/admin/ubus`,
      sid: 'abc',
      cookie: 'sysauth_http=abc',
      expiresInSec: 3600,
    });
    expect(http.requests[0].body).toBe('luci_username=root&luci_password=secret');
  });

  it('reports bad credentials when LuCI re-renders the login form', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/cgi-bin/luci/`, { status: 403, headers: {}, body: '<form>' });
    await expect(loginLuci({ http, baseUrl: BASE }, cred)).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });
  });
});

describe('login strategy', () => {
  it('prefers ubus', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/ubus`, ubusLoginOk('u1'));
    expect((await login({ http, baseUrl: BASE }, cred)).mode).toBe('ubus');
  });

  it('falls back to LuCI when /ubus does not exist', async () => {
    const http = new FakeHttpClient()
      .on(`POST ${BASE}/ubus`, { status: 404, headers: {}, body: '' })
      .on(`POST ${BASE}/cgi-bin/luci/`, { status: 302, headers: { 'set-cookie': ['sysauth_https=zz; path=/'] }, body: '' });
    const s = await login({ http, baseUrl: BASE }, cred);
    expect(s.mode).toBe('luci');
    expect(s.cookie).toBe('sysauth_https=zz');
  });

  it('does not retry with LuCI after a wrong password', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/ubus`, ubusLoginOk());
    await expect(login({ http, baseUrl: BASE }, { ...cred, password: 'nope' })).rejects.toBeInstanceOf(AuthError);
    expect(http.requests).toHaveLength(1);
  });

  it('tries the preferred mode first', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/cgi-bin/luci/`, {
      status: 302,
      headers: { 'set-cookie': ['sysauth=q'] },
      body: '',
    });
    const s = await login({ http, baseUrl: BASE }, cred, 'luci');
    expect(s.mode).toBe('luci');
    expect(http.requests[0].url).toBe(`${BASE}/cgi-bin/luci/`);
  });

  it('reports NO_ENDPOINT when neither endpoint exists', async () => {
    const http = new FakeHttpClient().on(() => true, { status: 404, headers: {}, body: '' });
    await expect(login({ http, baseUrl: BASE }, cred)).rejects.toMatchObject({ code: 'NO_ENDPOINT' });
  });

  it('forwards the TLS policy to every request', async () => {
    const http = new FakeHttpClient().on(`POST ${BASE}/ubus`, ubusLoginOk());
    const tls = { mode: 'pinned' as const, sha256: 'a'.repeat(64) };
    await login({ http, baseUrl: BASE, tls }, cred);
    expect(http.requests[0].tls).toEqual(tls);
  });
});

describe('findSysauth', () => {
  it('recognises all cookie names and skips deleted values', () => {
    expect(findSysauth(['sysauth=deleted; path=/', 'sysauth_http=good'])).toEqual({ name: 'sysauth_http', value: 'good' });
    expect(findSysauth(['sysauth_https=x'])).toEqual({ name: 'sysauth_https', value: 'x' });
    expect(findSysauth(['other=1'])).toBeNull();
    expect(findSysauth([])).toBeNull();
  });
});

it('json helper is used for responses', () => {
  expect(json({}).status).toBe(200);
});
