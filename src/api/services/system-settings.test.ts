import { FixtureConnection, ok } from '../../../test/fixture-connection';
import {
  getTimeSettings,
  getTimezones,
  setAdminPassword,
  syncRouterClock,
  timezoneChanges,
  validatePassword,
} from './system-settings';

const system = {
  values: {
    cfg01e48a: {
      '.name': 'cfg01e48a',
      '.type': 'system',
      hostname: 'OpenWrt',
      zonename: 'Asia/Shanghai',
      timezone: 'CST-8',
    },
    ntp: { '.name': 'ntp', '.type': 'timeserver', enabled: '1' },
  },
};

describe('time zone and clock', () => {
  it('lists time zones sorted, with their POSIX strings', async () => {
    const conn = new FixtureConnection('none').override(
      'luci.getTimezones',
      ok({
        'Europe/Berlin': { tzstring: 'CET-1CEST,M3.5.0,M10.5.0/3' },
        'Asia/Shanghai': { tzstring: 'CST-8' },
        UTC: { tzstring: 'UTC' },
      }),
    );
    expect(await getTimezones(conn)).toEqual([
      { zonename: 'Asia/Shanghai', tz: 'CST-8' },
      { zonename: 'Europe/Berlin', tz: 'CET-1CEST,M3.5.0,M10.5.0/3' },
      { zonename: 'UTC', tz: 'UTC' },
    ]);
  });

  it('reads the zone, the clock offset against the phone (from local time), and NTP', async () => {
    const conn = new FixtureConnection('none')
      .override('uci.get.system', ok(system))
      // `system info` reports local wall-clock time: UTC 1000 in Shanghai.
      .override('system.info', ok({ localtime: 1_000 + 8 * 3600 }));
    expect(await getTimeSettings(conn, 1_090)).toEqual({
      section: 'cfg01e48a',
      zonename: 'Asia/Shanghai',
      routerTime: 1_000,
      localTime: 1_000 + 8 * 3600,
      offsetSec: -90,
      ntp: true,
    });
  });

  it('changes the zone name and the POSIX string together', () => {
    expect(timezoneChanges('cfg01e48a', { zonename: 'Asia/Shanghai', tz: 'CST-8' })).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'system', section: 'cfg01e48a', values: { zonename: 'Asia/Shanghai', timezone: 'CST-8' } },
      },
    ]);
  });

  it('sets the router clock to the phone time', async () => {
    const conn = new FixtureConnection('none').override('luci.setLocaltime', ok({ result: 1_234 }));
    await syncRouterClock(conn, 1_234);
    expect(conn.calls[0].params).toEqual({ localtime: 1_234 });
  });
});

describe('admin password', () => {
  it('needs something sensible', () => {
    expect(validatePassword('', '')).toBe('empty');
    expect(validatePassword('abc', 'abd')).toBe('mismatch');
    expect(validatePassword('short', 'short')).toBe('weak');
    expect(validatePassword('correct horse', 'correct horse')).toBeNull();
  });

  it('calls luci setPassword and checks the answer', async () => {
    const conn = new FixtureConnection('none').override('luci.setPassword', ok({ result: true }));
    await setAdminPassword(conn, 'root', 'correct horse');
    expect(conn.calls[0].params).toEqual({ username: 'root', password: 'correct horse' });
    const refused = new FixtureConnection('none').override('luci.setPassword', ok({ result: false }));
    await expect(setAdminPassword(refused, 'root', 'x')).rejects.toMatchObject({ code: 'password-refused' });
  });
});
