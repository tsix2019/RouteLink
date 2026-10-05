import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { parseCrontab, serializeCrontab } from './cron';
import {
  getWifiSchedules,
  parseWifiSchedules,
  saveWifiSchedules,
  validateWifiSchedule,
  wifiOffNow,
  wifiScheduleCron,
  type WifiSchedule,
} from './wifi-schedule';

const nights: WifiSchedule = { radios: 'all', days: [0, 1, 2, 3, 4], off: '23:30', on: '07:00' };
const afternoon: WifiSchedule = { radios: ['radio1'], days: [1, 2, 3, 4, 5], off: '09:00', on: '17:00' };

describe('wifiScheduleCron', () => {
  it('writes an off and an on entry; the morning after midnight is the next day', () => {
    const text = serializeCrontab(wifiScheduleCron([], [nights]));
    expect(text).toBe(
      [
        '# RouteLink: wifi-schedule 1 off',
        '30 23 * * 0,1,2,3,4 /sbin/wifi down',
        '# RouteLink: wifi-schedule 1 on',
        '0 7 * * 1,2,3,4,5 /sbin/wifi up',
        '',
      ].join('\n'),
    );
  });

  it('names the radios and keeps the same days within a day', () => {
    const text = serializeCrontab(
      wifiScheduleCron([], [{ radios: ['radio0', 'radio1'], days: [6], off: '01:00', on: '06:15' }]),
    );
    expect(text).toContain('0 1 * * 6 /sbin/wifi down radio0; /sbin/wifi down radio1\n');
    expect(text).toContain('15 6 * * 6 /sbin/wifi up radio0; /sbin/wifi up radio1\n');
  });

  it('uses * for every day', () => {
    const text = serializeCrontab(wifiScheduleCron([], [{ ...nights, days: [0, 1, 2, 3, 4, 5, 6] }]));
    expect(text).toContain('30 23 * * * /sbin/wifi down\n');
    expect(text).toContain('0 7 * * * /sbin/wifi up\n');
  });

  it('replaces its own entries and leaves everything else where it was', () => {
    const user = parseCrontab('# backup\n0 3 * * * /root/backup.sh\n*/5 * * * * logger tick\n');
    const first = wifiScheduleCron(user, [nights, afternoon]);
    const second = wifiScheduleCron(first, [afternoon]);
    const text = serializeCrontab(second);
    expect(text.startsWith('# backup\n0 3 * * * /root/backup.sh\n*/5 * * * * logger tick\n')).toBe(true);
    expect(text).not.toContain('/sbin/wifi down\n');
    expect(parseWifiSchedules(second)).toEqual([afternoon]);
    expect(serializeCrontab(wifiScheduleCron(second, []))).toBe(serializeCrontab(user));
  });
});

describe('parseWifiSchedules', () => {
  it('reads back what wifiScheduleCron wrote', () => {
    expect(parseWifiSchedules(wifiScheduleCron([], [nights, afternoon]))).toEqual([nights, afternoon]);
  });

  it('skips a schedule with a missing half or a command it did not write', () => {
    const lines = parseCrontab(
      [
        '# RouteLink: wifi-schedule 1 off',
        '0 23 * * * /sbin/wifi down',
        '# RouteLink: wifi-schedule 2 off',
        '0 22 * * * /sbin/wifi down',
        '# RouteLink: wifi-schedule 2 on',
        '0 6 * * * /bin/echo hello',
      ].join('\n'),
    );
    expect(parseWifiSchedules(lines)).toEqual([]);
  });
});

describe('validateWifiSchedule', () => {
  it.each([
    [nights, null],
    [{ ...nights, days: [] }, 'days'],
    [{ ...nights, radios: [] }, 'radios'],
    [{ ...nights, on: '7:00' }, 'time'],
    [{ ...nights, on: '23:30' }, 'same'],
  ] as const)('%j → %s', (schedule, error) => {
    expect(validateWifiSchedule(schedule as WifiSchedule)).toBe(error);
  });
});

describe('wifiOffNow', () => {
  it.each([
    [0, '23:45', true],
    [1, '06:59', true],
    [1, '07:00', false],
    [5, '23:45', false],
    // Thursday night lasts into Friday morning.
    [5, '06:00', true],
    [6, '06:00', false],
  ] as const)('day %i at %s → %s', (weekday, time, off) => {
    const [h, m] = time.split(':').map(Number);
    expect(wifiOffNow([nights], 'radio0', weekday, h * 60 + m)).toBe(off);
  });

  it('only for the radios a schedule names', () => {
    expect(wifiOffNow([afternoon], 'radio1', 1, 10 * 60)).toBe(true);
    expect(wifiOffNow([afternoon], 'radio0', 1, 10 * 60)).toBe(false);
  });
});

describe('getWifiSchedules and saveWifiSchedules', () => {
  it('reads the crontab, and writes it back with cron reloaded', async () => {
    let crontab = '0 3 * * * /root/backup.sh\n';
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('file.read.etc-crontabs-root', () => ok({ data: crontab }))
      .override('file.write', (c) => {
        crontab = String((c.params as { data: string }).data);
        return ok({});
      })
      .override('file.exec', ok({ code: 0 }));
    const before = await getWifiSchedules(conn);
    expect(before.schedules).toEqual([]);
    await saveWifiSchedules(conn, [nights], before.crontab);
    expect((await getWifiSchedules(conn)).schedules).toEqual([nights]);
    expect(crontab.startsWith('0 3 * * * /root/backup.sh\n')).toBe(true);
    expect(conn.calls.filter((c) => c.object === 'file' && c.method === 'exec')).toHaveLength(1);
  });
});
