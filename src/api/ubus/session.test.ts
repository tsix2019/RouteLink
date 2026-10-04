import { FakeHttpClient, json } from '../http/fake';
import type { HttpRequest } from '../http/types';
import { UbusError } from './errors';
import { UbusSession } from './session';

const BASE = 'http://r';
const cred = { username: 'root', password: 'pw' };

/** Minimal stateful ubus: sessions can be expired; some methods are always ACL-denied. */
class FakeRouter {
  logins = 0;
  private next = 0;
  readonly valid = new Set<string>();
  readonly denied = new Set<string>(['file.exec']);
  reverseBatches = false;

  readonly http = new FakeHttpClient().on(`POST ${BASE}/ubus`, (req) => this.handle(req));

  expireAll() {
    this.valid.clear();
  }

  private handle(req: HttpRequest) {
    const payload = JSON.parse(req.body!);
    const calls: { id: number; params: [string, string, string, Record<string, unknown>] }[] = Array.isArray(payload)
      ? payload
      : [payload];
    let replies = calls.map(({ id, params: [sid, object, method, args] }) => {
      const key = `${object}.${method}`;
      if (key === 'session.login') {
        this.logins += 1;
        if (args.password !== 'pw') return { jsonrpc: '2.0', id, result: [6] };
        const s = `s${++this.next}`;
        this.valid.add(s);
        return { jsonrpc: '2.0', id, result: [0, { ubus_rpc_session: s, expires: 300 }] };
      }
      if (!this.valid.has(sid) || this.denied.has(key)) {
        return { jsonrpc: '2.0', id, error: { code: -32002, message: 'Access denied' } };
      }
      if (key === 'system.fail') return { jsonrpc: '2.0', id, result: [4] };
      return { jsonrpc: '2.0', id, result: [0, { key, sid }] };
    });
    if (this.reverseBatches) replies = replies.reverse();
    return json(Array.isArray(payload) ? replies : replies[0]);
  }
}

const session = (router: FakeRouter) => new UbusSession({ http: router.http, baseUrl: BASE }, cred);

it('logs in lazily on the first call', async () => {
  const router = new FakeRouter();
  const s = session(router);
  await expect(s.call('system', 'board')).resolves.toEqual({ key: 'system.board', sid: 's1' });
  expect(router.logins).toBe(1);
  expect(s.current?.sid).toBe('s1');
});

it('re-logs in once when the session expired and replays the call', async () => {
  const router = new FakeRouter();
  const s = session(router);
  await s.call('system', 'board');
  router.expireAll();
  await expect(s.call('system', 'info')).resolves.toEqual({ key: 'system.info', sid: 's2' });
  expect(router.logins).toBe(2);
});

it('shares a single re-login between concurrent calls', async () => {
  const router = new FakeRouter();
  const s = session(router);
  await s.call('system', 'board');
  router.expireAll();
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => s.call('system', 'info')));
  expect(results.every((r) => (r as { sid: string }).sid === 's2')).toBe(true);
  expect(router.logins).toBe(2);
});

it('treats a denial that survives re-login as a permission error, and stops re-logging in for it', async () => {
  const router = new FakeRouter();
  const s = session(router);
  await s.call('system', 'board');
  await expect(s.call('file', 'exec')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', call: 'file.exec' });
  const loginsAfterFirst = router.logins;
  await expect(s.call('file', 'exec')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  expect(router.logins).toBe(loginsAfterFirst);
});

it('never re-logs in when relogin is disabled (uci confirm must keep its session)', async () => {
  const router = new FakeRouter();
  const s = session(router);
  await s.call('system', 'board');
  router.expireAll();
  await expect(s.call('uci', 'confirm', {}, { relogin: false })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(router.logins).toBe(1);
});

it('sends batches as one request and maps replies by id', async () => {
  const router = new FakeRouter();
  router.reverseBatches = true;
  const s = session(router);
  await s.call('system', 'board');
  const before = router.http.requests.length;
  const results = await s.batch([
    { object: 'system', method: 'board' },
    { object: 'system', method: 'fail' },
    { object: 'system', method: 'info' },
  ]);
  expect(router.http.requests.length - before).toBe(1);
  expect(results[0]).toEqual({ ok: true, data: { key: 'system.board', sid: 's1' } });
  expect(results[1].ok).toBe(false);
  expect(!results[1].ok && results[1].error).toBeInstanceOf(UbusError);
  expect(!results[1].ok && results[1].error.code).toBe('NOT_FOUND');
  expect(results[2]).toEqual({ ok: true, data: { key: 'system.info', sid: 's1' } });
});

it('sends the LuCI cookie and treats HTTP 403 as an expired session', async () => {
  let loginCount = 0;
  const http = new FakeHttpClient()
    .on(`POST ${BASE}/ubus`, { status: 404, headers: {}, body: '' })
    .on(`POST ${BASE}/cgi-bin/luci/`, () => {
      loginCount += 1;
      return { status: 302, headers: { 'set-cookie': [`sysauth_http=c${loginCount}`] }, body: '' };
    })
    .on(`POST ${BASE}/cgi-bin/luci/admin/ubus`, { status: 403, headers: {}, body: '' }, 1)
    .on(`POST ${BASE}/cgi-bin/luci/admin/ubus`, (req) => {
      const { id } = JSON.parse(req.body!);
      return json({ jsonrpc: '2.0', id, result: [0, { cookie: req.headers?.Cookie }] });
    });
  const s = new UbusSession({ http, baseUrl: BASE }, cred);
  await expect(s.call('system', 'board')).resolves.toEqual({ cookie: 'sysauth_http=c2' });
  expect(loginCount).toBe(2);
});

it('notifies the detected login mode', async () => {
  const router = new FakeRouter();
  const onLogin = jest.fn();
  const s = new UbusSession({ http: router.http, baseUrl: BASE }, cred, { onLogin });
  await s.call('system', 'board');
  expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ubus', sid: 's1' }));
});

it('surfaces bad credentials', async () => {
  const router = new FakeRouter();
  const s = new UbusSession({ http: router.http, baseUrl: BASE }, { username: 'root', password: 'bad' });
  await expect(s.call('system', 'board')).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });
});
