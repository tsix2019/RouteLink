import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { canSignal, listProcesses, parseProcesses, signalProcess } from './processes';

const raw = {
  result: [
    { PID: '1', PPID: '0', USER: 'root', STAT: 'S', VSZ: '1564', '%MEM': '0%', '%CPU': '0%', COMMAND: '/sbin/procd' },
    { PID: '2', PPID: '0', USER: 'root', STAT: 'SW', VSZ: '0', '%MEM': '0%', '%CPU': '0%', COMMAND: '[kthreadd]' },
    {
      PID: '832',
      PPID: '1',
      USER: 'root',
      STAT: 'S  ',
      VSZ: '1796',
      '%MEM': '1%',
      '%CPU': '3%',
      COMMAND: '/sbin/netifd',
    },
    {
      PID: '44126',
      PPID: '1',
      USER: 'network',
      STAT: 'R',
      VSZ: '12m',
      '%MEM': '12%',
      '%CPU': '27%',
      COMMAND: '/usr/sbin/uhttpd -f -h /www -r OpenWrt',
    },
  ],
};

describe('parseProcesses', () => {
  it('reads LuCI’s process list', () => {
    const ps = parseProcesses(raw);
    expect(ps.find((p) => p.pid === 832)).toEqual({
      pid: 832,
      ppid: 1,
      user: 'root',
      state: 'S',
      memoryKb: 1796,
      memPercent: 1,
      cpuPercent: 3,
      command: '/sbin/netifd',
      name: 'netifd',
      kernel: false,
    });
  });

  it('understands busybox sizes with a unit and kernel threads', () => {
    const ps = parseProcesses(raw);
    expect(ps.find((p) => p.pid === 44126)).toMatchObject({ memoryKb: 12 * 1024, name: 'uhttpd', cpuPercent: 27 });
    expect(ps.find((p) => p.pid === 2)).toMatchObject({ kernel: true, name: 'kthreadd' });
  });

  it('sorts by CPU, then memory', () => {
    expect(parseProcesses(raw).map((p) => p.pid)).toEqual([44126, 832, 1, 2]);
  });

  it('tolerates garbage', () => {
    expect(parseProcesses({})).toEqual([]);
    expect(parseProcesses({ result: [null, { PID: 'x' }] })).toEqual([]);
  });
});

describe('signals', () => {
  it('never signals PID 1 or kernel threads', () => {
    const ps = parseProcesses(raw);
    expect(ps.filter(canSignal).map((p) => p.pid)).toEqual([44126, 832]);
  });

  it('sends the signal the way LuCI does', async () => {
    const conn = new FixtureConnection('none').override('file.exec', ok({ code: 0 }));
    await signalProcess(conn, 832, 'TERM');
    await signalProcess(conn, 832, 'KILL');
    expect(conn.calls.map((c) => c.params)).toEqual([
      { command: '/bin/kill', params: ['-15', '832'] },
      { command: '/bin/kill', params: ['-9', '832'] },
    ]);
  });

  it('reports a failed kill', async () => {
    const conn = new FixtureConnection('none').override('file.exec', ok({ code: 1, stderr: 'No such process' }));
    await expect(signalProcess(conn, 5, 'TERM')).rejects.toMatchObject({ code: 'kill-failed' });
  });

  it('lists through luci', async () => {
    const conn = new FixtureConnection('none').override('luci.getProcessList', ok(raw));
    expect(await listProcesses(conn)).toHaveLength(4);
  });
});
