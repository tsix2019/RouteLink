// M2 services against a real router (QEMU in CI: hwsim radios, a WAN zone, a test cron entry, a
// WireGuard peer and a `sleep` process to stop). Everything changed here is put back.
import { getGuestState, createGuestChanges, deleteGuestChanges } from '../../src/api/services/guest';
import { getTimeSettings, getTimezones, timezoneChanges } from '../../src/api/services/system-settings';
import { macFilterChanges, parseMacFilters } from '../../src/api/services/macfilter';
import { listAvailable, listInstalled, installPackages } from '../../src/api/services/package-list';
import { detectPackageEnv, removePackages, updateLists } from '../../src/api/services/packages';
import { canSignal, listProcesses, signalProcess } from '../../src/api/services/processes';
import { parseCrontab, readCrontab, writeCrontab } from '../../src/api/services/cron';
import { getWireGuard } from '../../src/api/services/wireguard';
import { stageAndApply, uci } from '../../src/api/uci';
import { connect, waitFor } from './router';

const fast = { timeoutSec: 30 };
const strict = process.env.EXPECT_RADIOS === '1';

describe('M2: system pages', () => {
  const { conn } = connect();

  it('lists processes and stops the test sleep process', async () => {
    const ps = await listProcesses(conn);
    expect(ps.some((p) => p.name === 'uhttpd')).toBe(true);
    const sleeper = ps.find((p) => p.command.startsWith('sleep 99999') || p.command.endsWith('sleep 99999'));
    if (!sleeper) {
      if (strict) throw new Error('the QEMU setup starts "sleep 99999"');
      return;
    }
    expect(canSignal(sleeper)).toBe(true);
    await signalProcess(conn, sleeper.pid, 'TERM');
    expect(await waitFor(async () => !(await listProcesses(conn)).some((p) => p.pid === sleeper.pid), 10_000)).toBe(
      true,
    );
  });

  it('adds, reads back and removes a scheduled task', async () => {
    const before = await readCrontab(conn);
    const [line] = parseCrontab('15 4 * * 0 logger routelink-m2-test');
    await writeCrontab(conn, [...before.lines, line], before.original);
    const added = await readCrontab(conn);
    expect(added.original).toContain('logger routelink-m2-test');
    await writeCrontab(
      conn,
      added.lines.filter((l) => !(l.kind === 'entry' && l.command === 'logger routelink-m2-test')),
      added.original,
    );
    expect((await readCrontab(conn)).original).toBe(before.original);
  });

  it('changes the time zone and puts it back', async () => {
    const before = await getTimeSettings(conn);
    const zones = await getTimezones(conn);
    const target = zones.find(
      (z) => z.zonename === (before.zonename === 'Asia/Shanghai' ? 'Europe/Berlin' : 'Asia/Shanghai'),
    )!;
    await stageAndApply(conn, timezoneChanges(before.section, target), { mode: 'direct' });
    expect((await getTimeSettings(conn)).zonename).toBe(target.zonename);
    const original = zones.find((z) => z.zonename === before.zonename) ?? { zonename: 'UTC', tz: 'UTC' };
    await stageAndApply(conn, timezoneChanges(before.section, original), { mode: 'direct' });
    const after = await getTimeSettings(conn);
    expect(after.zonename).toBe(before.zonename);
    // The clock read back through system info stays within a few seconds of the host's.
    expect(Math.abs(after.offsetSec)).toBeLessThan(120);
  });

  it('reads WireGuard with the test peer', async () => {
    const wg = await getWireGuard(conn);
    if (!wg.length) {
      if (strict) throw new Error('the QEMU setup creates wg0');
      return;
    }
    expect(wg[0].peers.some((p) => p.name === 'Test peer')).toBe(true);
  });
});

describe('M2: packages', () => {
  const { conn } = connect();

  it('lists, updates, installs and removes a small package', async () => {
    const env = await detectPackageEnv(conn);
    if ('unsupported' in env) throw new Error(env.unsupported);
    expect((await listInstalled(conn, env)).length).toBeGreaterThan(50);
    await updateLists(conn, env);
    const available = await listAvailable(conn, env);
    expect(available.length).toBeGreaterThan(1000);
    if (!strict) return; // installs reach the internet: CI only
    const name = 'tcpdump-mini';
    expect(available.some((p) => p.name === name)).toBe(true);
    expect((await installPackages(conn, env, [name])).ok).toBe(true);
    expect((await listInstalled(conn, env)).some((p) => p.name === name)).toBe(true);
    expect((await removePackages(conn, env, [name])).ok).toBe(true);
    expect((await listInstalled(conn, env)).some((p) => p.name === name)).toBe(false);
  }, 300_000);
});

describe('M2: guest network and MAC filter', () => {
  const { conn } = connect();

  it('creates the guest network on the radios and removes it again', async () => {
    const state = await getGuestState(conn);
    if (state.support.status !== 'ok') {
      if (strict) throw new Error(`guest network: ${state.support.status}`);
      return;
    }
    expect(state.guest).toBeNull();
    const input = {
      ssid: 'RouteLink-Guest-Test',
      encryption: 'psk2' as const,
      key: 'guest-test-123',
      radios: state.radios.map((r) => r.name),
      ipaddr: state.freeAddress,
      isolate: true,
    };
    const created = await stageAndApply(
      conn,
      createGuestChanges(input, { style: state.style, wanZone: state.support.wanZone }),
      { mode: 'rollback', ...fast },
    );
    expect(created.status).toBe('confirmed');
    const after = await getGuestState(conn);
    expect(after.guest?.wifi.map((w) => w.ssid)).toEqual(state.radios.map(() => 'RouteLink-Guest-Test'));
    expect(after.guest?.ipaddr).toBe(state.freeAddress);
    expect((await stageAndApply(conn, deleteGuestChanges(after.configs), { mode: 'rollback', ...fast })).status).toBe(
      'confirmed',
    );
    expect((await getGuestState(conn)).guest).toBeNull();
  }, 180_000);

  it('sets a deny list on an access point and switches it off again', async () => {
    // Routers without radios have no wireless config at all.
    const filters = parseMacFilters(await uci.get(conn, 'wireless').catch(() => ({})));
    if (!filters.length) {
      if (strict) throw new Error('no access points');
      return;
    }
    const ap = filters[0];
    await stageAndApply(conn, macFilterChanges(ap, 'deny', ['02:00:00:00:00:99']), { mode: 'rollback', ...fast });
    const denied = parseMacFilters(await uci.get(conn, 'wireless')).find((f) => f.section === ap.section)!;
    expect(denied).toMatchObject({ mode: 'deny', macs: ['02:00:00:00:00:99'] });
    await stageAndApply(conn, macFilterChanges(denied, 'disable', []), { mode: 'rollback', ...fast });
    expect(parseMacFilters(await uci.get(conn, 'wireless')).find((f) => f.section === ap.section)?.mode).toBe(
      'disable',
    );
  }, 120_000);
});
