// rpcd's apply/confirm/rollback, as the safe-apply flow (src/api/uci.ts) relies on it.
// Findings recorded in the plan's execution log (T24/T60): A1 confirm keeps the change, A2 confirm
// without a pending apply is NO_DATA, A3 only the applying session may confirm, A4 an unconfirmed apply is rolled
// back and its changes return to the applying session's staging area, A5 root may not `uci revert`
// over ubus — which is why every change set is staged in a session of its own.
import { UbusError } from '../../src/api/ubus/errors';
import { stageAndApply, uci, type UciSection } from '../../src/api/uci';
import { connect, sleep } from './router';

const OPTION = 'routelink_test';
type Conn = ReturnType<typeof connect>['conn'];

async function systemSection(conn: Conn): Promise<string> {
  const values = await uci.get(conn, 'system');
  const s = Object.values(values).find((v: UciSection) => v['.type'] === 'system');
  if (!s) throw new Error('no system section');
  return s['.name'];
}

async function readOption(conn: Conn, section: string): Promise<string | undefined> {
  const r = await conn
    .call<{ value?: string }>('uci', 'get', { config: 'system', section, option: OPTION })
    .catch((e: unknown) => {
      if (e instanceof UbusError && e.code === 'NOT_FOUND') return {} as { value?: string };
      throw e;
    });
  return r.value;
}

describe('rpcd apply / confirm / rollback', () => {
  const main = connect().conn;
  let section = '';

  beforeAll(async () => {
    section = await systemSection(main);
  });

  afterAll(async () => {
    await stageAndApply(main, [uci.delOption('system', section, OPTION)], { mode: 'direct' }).catch(() => undefined);
  });

  it('A5: root may not revert or commit over ubus', async () => {
    for (const fn of ['revert', 'commit']) {
      const r = await main.call<{ access?: boolean }>('session', 'access', {
        scope: 'ubus',
        object: 'uci',
        function: fn,
      });
      expect(r.access).toBe(false);
    }
  });

  it('A2: confirm without a pending apply is NO_DATA', async () => {
    const error = await main.call('uci', 'confirm', {}, { relogin: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UbusError);
    expect((error as UbusError).code).toBe('NO_DATA');
  });

  it('A1: a confirmed change survives the rollback timer', async () => {
    const value = `confirmed-${Date.now()}`;
    const outcome = await stageAndApply(main, [uci.set('system', section, { [OPTION]: value })], {
      mode: 'rollback',
      timeoutSec: 15,
    });
    expect(outcome.status).toBe('confirmed');
    await sleep(20_000);
    expect(await readOption(main, section)).toBe(value);
  }, 60_000);

  it('A4: an unconfirmed change is rolled back and lands in the staging area again', async () => {
    const before = await readOption(main, section);
    const applier = connect().conn;
    await applier.call('uci', 'set', { config: 'system', section, values: { [OPTION]: 'unconfirmed' } });
    await applier.call('uci', 'apply', { rollback: true, timeout: 10 });
    await sleep(16_000);
    expect(await readOption(main, section)).toBe(before);
    const changes = await applier.call<{ changes?: Record<string, unknown[]> }>('uci', 'changes', {});
    expect(JSON.stringify(changes.changes?.system ?? [])).toContain('unconfirmed');
    // ...and only there: the main session's staging stays clean.
    const mainChanges = await main.call<{ changes?: Record<string, unknown[]> }>('uci', 'changes', {});
    expect(mainChanges.changes?.system).toBeUndefined();
  }, 60_000);

  it('A3: only the applying session may confirm', async () => {
    const value = `own-session-${Date.now()}`;
    const applier = connect().conn;
    await applier.call('uci', 'set', { config: 'system', section, values: { [OPTION]: value } });
    await applier.call('uci', 'apply', { rollback: true, timeout: 15 });
    await sleep(1_500);
    const other = await main.call('uci', 'confirm', {}, { relogin: false }).catch((e: unknown) => e);
    expect(other).toBeInstanceOf(UbusError);
    expect((other as UbusError).code).toBe('PERMISSION_DENIED');
    await expect(applier.call('uci', 'confirm', {}, { relogin: false })).resolves.toBeDefined();
    await sleep(20_000);
    expect(await readOption(main, section)).toBe(value);
  }, 60_000);
});
