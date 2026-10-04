import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import { NativeError } from '../http/errors';
import { getSystem, getTemperature, loadRatio, reboot } from './system';

describe('getSystem (OpenWrt 24.10 fixture)', () => {
  it('parses board and info in one request', async () => {
    const conn = new FixtureConnection();
    const batch = jest.spyOn(conn, 'batch');
    const s = await getSystem(conn);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(s.distribution).toBe('OpenWrt');
    expect(s.version).toBe('24.10.8');
    expect(s.firmware).toBe('OpenWrt 24.10.8 r29233-443ec4032a');
    expect(s.target).toBe('x86/64');
    expect(s.model).toBe('13th Gen Intel(R) Core(TM) i5-13500H'); // x86: no board model, CPU name instead
    expect(s.uptimeSec).toBe(488);
    expect(s.load[1]).toBeCloseTo(2560 / 65536);
    expect(s.memory.total).toBe(8187625472);
    expect(s.memory.used).toBe(8187625472 - 7228305408);
    expect(s.storage.root).toEqual({ total: 1055762868 * 1024, used: 31741688 * 1024 });
    expect(s.cpuCores).toBeGreaterThan(0);
  });

  it('prefers the board model when present', async () => {
    const conn = new FixtureConnection().override(
      'system.board',
      ok({ hostname: 'OpenWrt', model: 'OpenWrt One', board_name: 'openwrt,one', release: { version: '24.10.8' } }),
    );
    const s = await getSystem(conn);
    expect(s.model).toBe('OpenWrt One');
    expect(s.boardName).toBe('openwrt,one');
  });

  it('tolerates a missing CPU listing', async () => {
    const conn = new FixtureConnection().override('file.list.sys-devices-system-cpu', fail('PERMISSION_DENIED'));
    const s = await getSystem(conn);
    expect(s.cpuCores).toBeNull();
    expect(loadRatio(s)).toBeNull();
  });

  it('computes the load ratio against the core count', async () => {
    const conn = new FixtureConnection()
      .override('system.info', ok({ load: [2 * 65536, 0, 0], memory: {} }))
      .override('file.list.sys-devices-system-cpu', ok({ entries: [
        { name: 'cpu0', type: 'directory' },
        { name: 'cpu1', type: 'directory' },
        { name: 'cpu2', type: 'directory' },
        { name: 'cpu3', type: 'directory' },
        { name: 'cpuidle', type: 'directory' },
      ] }));
    const s = await getSystem(conn);
    expect(s.cpuCores).toBe(4);
    expect(loadRatio(s)).toBe(0.5);
  });
});

describe('getTemperature', () => {
  it('is null on stock OpenWrt (ACL denied)', async () => {
    await expect(getTemperature(new FixtureConnection())).resolves.toBeNull();
  });

  it('reads the hottest sensor and converts millidegrees', async () => {
    const conn = new FixtureConnection().override('luci.getTempInfo', ok({ cpu: 48500, wifi: { value: 51000 } }));
    await expect(getTemperature(conn)).resolves.toBe(51);
  });
});

describe('reboot', () => {
  it('treats a dropped connection as success', async () => {
    const conn = new FixtureConnection();
    jest.spyOn(conn, 'call').mockRejectedValueOnce(new NativeError('ERR_TIMEOUT', ''));
    await expect(reboot(conn)).resolves.toBeUndefined();
  });

  it('runs /sbin/reboot', async () => {
    const conn = new FixtureConnection().override('file.exec.sbin-reboot', ok({ code: 0 }));
    await reboot(conn);
    expect(conn.calls).toContainEqual({ object: 'file', method: 'exec', params: { command: '/sbin/reboot' } });
  });
});
