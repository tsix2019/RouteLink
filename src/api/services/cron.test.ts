import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import {
  describeSchedule,
  parseCrontab,
  readCrontab,
  serializeCrontab,
  validateSchedule,
  writeCrontab,
  type CronEntry,
} from './cron';

const text = [
  '# rotate logs',
  '0 4 * * * /usr/sbin/logrotate',
  '*/30 * * * * logger routelink-test',
  '',
  '# RouteLink: wifi off',
  '0 23 * * 1-5 wifi down',
].join('\n');

describe('parseCrontab / serializeCrontab', () => {
  it('reads entries and keeps comments and blank lines', () => {
    const tab = parseCrontab(text);
    const entries = tab.filter((l): l is CronEntry => l.kind === 'entry');
    expect(entries.map((e) => [e.schedule.join(' '), e.command])).toEqual([
      ['0 4 * * *', '/usr/sbin/logrotate'],
      ['*/30 * * * *', 'logger routelink-test'],
      ['0 23 * * 1-5', 'wifi down'],
    ]);
    expect(entries[2].managed).toBe(true);
    expect(serializeCrontab(tab)).toBe(`${text}\n`);
  });

  it('keeps lines it does not understand', () => {
    const tab = parseCrontab('@reboot something\nMAILTO=x');
    expect(tab.every((l) => l.kind === 'other')).toBe(true);
    expect(serializeCrontab(tab)).toBe('@reboot something\nMAILTO=x\n');
  });
});

describe('validateSchedule', () => {
  it.each([
    ['0 4 * * *', null],
    ['*/15 * * * *', null],
    ['0 8-18/2 * * mon-fri', null],
    ['30 3 1,15 jan,jul 0', null],
    ['60 * * * *', 'minute'],
    ['0 24 * * *', 'hour'],
    ['0 0 0 * *', 'day'],
    ['0 0 * 13 *', 'month'],
    ['0 0 * * 8', 'weekday'],
    ['* * * *', 'fields'],
    ['*/0 * * * *', 'minute'],
  ])('%s → %s', (line, expected) => {
    expect(validateSchedule(line.split(' '))).toBe(expected);
  });
});

describe('describeSchedule', () => {
  it.each([
    ['*/30 * * * *', 'zh-CN', '每 30 分钟'],
    ['0 4 * * *', 'zh-CN', '每天 04:00'],
    ['5 23 * * 1-5', 'zh-CN', '周一至周五 23:05'],
    ['0 9 1 * *', 'zh-CN', '每月 1 日 09:00'],
    ['0 4 * * *', 'en', 'Every day at 04:00'],
    ['*/30 * * * *', 'en', 'Every 30 minutes'],
    ['0 23 * * 0', 'en', 'Sundays at 23:00'],
    ['7 1-3 * 2 *', 'en', null],
  ] as const)('%s (%s) → %s', (line, lang, expected) => {
    expect(describeSchedule(line.split(' '), lang)).toBe(expected);
  });
});

describe('reading and writing', () => {
  it('reads the root crontab, empty when there is none', async () => {
    const conn = new FixtureConnection('none').override('file.read', ok({ data: text }));
    expect((await readCrontab(conn)).original).toBe(text);
    const none = new FixtureConnection('none').override('file.read', fail('NOT_FOUND'));
    expect((await readCrontab(none)).lines).toEqual([]);
  });

  it('writes the file and reloads cron, unless it changed meanwhile', async () => {
    const conn = new FixtureConnection('none')
      .override('file.read', ok({ data: text }))
      .override('file.write', ok({}))
      .override('file.exec', ok({ code: 0 }));
    const tab = parseCrontab(text);
    await writeCrontab(conn, tab, text);
    expect(conn.calls.find((c) => c.method === 'write')?.params).toEqual({
      path: '/etc/crontabs/root',
      data: `${text}\n`,
    });
    expect(conn.calls.find((c) => c.method === 'exec')?.params).toEqual({ command: '/etc/init.d/cron', params: ['reload'] });

    await expect(writeCrontab(conn, tab, 'something else')).rejects.toMatchObject({ code: 'cron-changed' });
  });
});
