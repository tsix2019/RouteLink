import { NativeError } from './http/errors';
import type { RouterConnection } from './connection/types';
import { UbusError } from './ubus/errors';
import type { UbusCall, UbusResult } from './ubus/types';
import { stageAndApply, uci } from './uci';

type Responder = (call: UbusCall) => unknown | Error;

/** Records calls; `respond` decides each answer (Error → rejected / failed result). */
class ScriptedConnection implements RouterConnection {
  readonly kind = 'live' as const;
  readonly routerId = 'r';
  readonly log: string[] = [];
  constructor(private readonly respond: Responder) {}

  async call<T>(object: string, method: string, params?: Record<string, unknown>): Promise<T> {
    const [r] = await this.batch([{ object, method, params }]);
    if (!r.ok) throw r.error;
    return r.data as T;
  }

  async batch(calls: UbusCall[]): Promise<UbusResult[]> {
    const out: UbusResult[] = [];
    for (const c of calls) {
      this.log.push(`${c.object}.${c.method}${c.params?.config ? `(${c.params.config})` : ''}`);
      const r = this.respond(c);
      if (r instanceof NativeError) throw r; // transport errors reject the whole request
      out.push(r instanceof UbusError ? { ok: false, error: r } : { ok: true, data: r ?? {} });
    }
    return out;
  }

  async ping() {
    return true;
  }
}

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const changes = [
  uci.add('dhcp', 'host', { name: 'tv', mac: 'AA:BB:CC:00:11:22' }),
  uci.set('firewall', 'cfg1', { enabled: '0' }),
];

it('direct mode reverts stale changes, stages, and applies without rollback', async () => {
  const conn = new ScriptedConnection(() => ({}));
  const outcome = await stageAndApply(conn, changes, { mode: 'direct', ...clock() });
  expect(outcome).toEqual({ status: 'applied' });
  expect(conn.log).toEqual([
    'uci.revert(dhcp)',
    'uci.revert(firewall)',
    'uci.add(dhcp)',
    'uci.set(firewall)',
    'uci.apply',
  ]);
});

it('confirms after a rollback-protected apply', async () => {
  const conn = new ScriptedConnection(() => ({}));
  const outcome = await stageAndApply(conn, changes, { mode: 'rollback', ...clock() });
  expect(outcome).toEqual({ status: 'confirmed' });
  expect(conn.log.slice(-2)).toEqual(['uci.apply', 'uci.confirm']);
});

it('keeps confirming while the router is unreachable', async () => {
  let confirmAttempts = 0;
  const conn = new ScriptedConnection((c) => {
    if (c.method === 'confirm') {
      confirmAttempts += 1;
      if (confirmAttempts < 3) return new NativeError('ERR_UNREACHABLE', 'down');
    }
    return {};
  });
  const outcome = await stageAndApply(conn, changes, { mode: 'rollback', ...clock() });
  expect(outcome).toEqual({ status: 'confirmed' });
  expect(confirmAttempts).toBe(3);
});

it('treats NO_DATA from confirm as nothing left to roll back', async () => {
  const conn = new ScriptedConnection((c) => (c.method === 'confirm' ? new UbusError('NO_DATA', 'uci.confirm') : {}));
  await expect(stageAndApply(conn, changes, { mode: 'rollback', ...clock() })).resolves.toEqual({ status: 'applied' });
});

it('reports a rollback when the router never comes back, and clears the restored staging', async () => {
  const conn = new ScriptedConnection((c) => (c.method === 'confirm' ? new NativeError('ERR_TIMEOUT', 'down') : {}));
  const outcome = await stageAndApply(conn, changes, { mode: 'rollback', timeoutSec: 90, ...clock() });
  expect(outcome).toEqual({ status: 'rolled-back', reason: 'confirm-timeout' });
  expect(conn.log.slice(-2)).toEqual(['uci.revert(dhcp)', 'uci.revert(firewall)']);
});

it('stops confirming before the router-side timeout', async () => {
  const c = clock();
  const conn = new ScriptedConnection((call) => (call.method === 'confirm' ? new NativeError('ERR_TIMEOUT', '') : {}));
  await stageAndApply(conn, changes, { mode: 'rollback', timeoutSec: 30, ...c });
  expect(c.now()).toBeLessThanOrEqual(30_000);
});

it('reverts and rethrows when staging fails, without applying', async () => {
  const conn = new ScriptedConnection((c) => (c.method === 'set' ? new UbusError('INVALID_ARGUMENT', 'uci.set') : {}));
  await expect(stageAndApply(conn, changes, { mode: 'rollback', ...clock() })).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  });
  expect(conn.log).not.toContain('uci.apply');
  expect(conn.log.slice(-2)).toEqual(['uci.revert(dhcp)', 'uci.revert(firewall)']);
});

it('passes the rollback timeout to apply', async () => {
  const seen: UbusCall[] = [];
  const conn = new ScriptedConnection((c) => {
    seen.push(c);
    return {};
  });
  await stageAndApply(conn, changes, { mode: 'rollback', timeoutSec: 45, ...clock() });
  expect(seen.find((c) => c.method === 'apply')?.params).toEqual({ rollback: true, timeout: 45 });
});

it('surfaces unexpected confirm errors', async () => {
  const conn = new ScriptedConnection((c) =>
    c.method === 'confirm' ? new UbusError('INVALID_ARGUMENT', 'uci.confirm') : {},
  );
  await expect(stageAndApply(conn, changes, { mode: 'rollback', ...clock() })).rejects.toMatchObject({
    code: 'INVALID_ARGUMENT',
  });
});

describe('uci helpers', () => {
  it('builds staging calls', () => {
    expect(uci.set('dhcp', 'cfg1', { name: 'x' })).toEqual({
      object: 'uci',
      method: 'set',
      params: { config: 'dhcp', section: 'cfg1', values: { name: 'x' } },
    });
    expect(uci.add('dhcp', 'host', { mac: 'm' }, 'named')).toEqual({
      object: 'uci',
      method: 'add',
      params: { config: 'dhcp', type: 'host', values: { mac: 'm' }, name: 'named' },
    });
    expect(uci.del('firewall', 'cfg9')).toEqual({
      object: 'uci',
      method: 'delete',
      params: { config: 'firewall', section: 'cfg9' },
    });
    expect(uci.delOption('dhcp', 'cfg1', 'ip')).toEqual({
      object: 'uci',
      method: 'delete',
      params: { config: 'dhcp', section: 'cfg1', option: 'ip' },
    });
  });
});
