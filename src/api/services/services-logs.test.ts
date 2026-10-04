import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { kernelLog, parseDmesg, parseSyslog, systemLog } from './logs';
import { isCritical, listServices, serviceAction } from './services';

describe('services', () => {
  it('lists services from rc list, sorted (24.10 fixture)', async () => {
    const services = await listServices(new FixtureConnection());
    expect(services.length).toBe(22);
    expect(services.map((s) => s.name)).toEqual([...services.map((s) => s.name)].sort((a, b) => a.localeCompare(b)));
    expect(services.find((s) => s.name === 'uhttpd')).toEqual({ name: 'uhttpd', enabled: true, running: true, start: 50 });
  });

  it('runs rc init and validates the name', async () => {
    const conn = new FixtureConnection().override('rc.init', ok({}));
    await serviceAction(conn, 'cron', 'restart');
    expect(conn.calls[0]).toEqual({ object: 'rc', method: 'init', params: { name: 'cron', action: 'restart' } });
    await expect(serviceAction(conn, 'cron; reboot', 'stop')).rejects.toThrow(/invalid/);
  });

  it('knows which services keep the router reachable', () => {
    expect(isCritical('uhttpd')).toBe(true);
    expect(isCritical('cron')).toBe(false);
  });
});

describe('parseSyslog', () => {
  it('splits time, facility, level, source and text', () => {
    expect(
      parseSyslog(
        "Sun Oct  4 15:30:11 2026 daemon.notice netifd: Interface 'lan' is now up\nSun Oct  4 15:30:11 2026 user.err : jail: failed\nSun Oct  4 15:30:12 2026 kern.warning kernel: [ 1.0] x\ngarbage line",
      ),
    ).toEqual([
      { time: 'Sun Oct 4 15:30:11 2026', facility: 'daemon', level: 'notice', source: 'netifd', text: "Interface 'lan' is now up" },
      { time: 'Sun Oct 4 15:30:11 2026', facility: 'user', level: 'err', source: undefined, text: 'jail: failed' },
      { time: 'Sun Oct 4 15:30:12 2026', facility: 'kern', level: 'warn', source: 'kernel', text: '[ 1.0] x' },
      { text: 'garbage line' },
    ]);
  });
});

describe('parseDmesg', () => {
  it('extracts level and seconds since boot', () => {
    expect(parseDmesg('<6>[   12.345678] eth0: link up\n<3>[13.000000] oops\nplain')).toEqual([
      { time: '12.345678', level: 'info', text: 'eth0: link up' },
      { time: '13.000000', level: 'err', text: 'oops' },
      { text: 'plain' },
    ]);
  });
});

describe('log readers', () => {
  it('reads the system log through syslog-wrapper (24.10 fixture)', async () => {
    const lines = await systemLog(new FixtureConnection());
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.some((l) => l.source === 'dnsmasq')).toBe(true);
  });

  it('surfaces a failing dmesg (Docker cannot read the kernel ring buffer)', async () => {
    await expect(kernelLog(new FixtureConnection())).rejects.toThrow('klogctl: Operation not permitted');
  });

  it('parses dmesg output when available', async () => {
    const conn = new FixtureConnection().override('file.exec.bin-dmesg-r', ok({ code: 0, stdout: '<6>[ 1.0] booted\n' }));
    await expect(kernelLog(conn)).resolves.toEqual([{ time: '1.0', level: 'info', text: 'booted' }]);
  });
});
