import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { NativeError } from '../http/errors';
import type { UciSection } from '../uci';
import { parseCrontab, serializeCrontab } from './cron';
import { parseFirewall } from './firewall';
import {
  activePeriod,
  flushCommand,
  getParental,
  parseSchedules,
  saveSchedule,
  scheduleChanges,
  scheduleCron,
  validatePeriod,
  type BlockPeriod,
} from './parental';

const MAC = 'AA:BB:CC:00:11:22';

/** The uci sections that scheduleChanges would add, as `uci get` returns them. */
function asSections(periods: BlockPeriod[], enabled = true): Record<string, UciSection> {
  const out: Record<string, UciSection> = {};
  scheduleChanges(MAC, periods, enabled).forEach((c, i) => {
    const p = c.params as { type: string; values: Record<string, string | string[]> };
    out[`r${i}`] = { '.name': `r${i}`, '.type': p.type, '.index': i, ...p.values };
  });
  return out;
}

describe('scheduleChanges', () => {
  it('writes one rule for a period within a day', () => {
    const changes = scheduleChanges(MAC, [{ days: [1, 2, 3, 4, 5], from: '13:00', to: '15:30' }], true);
    expect(changes).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'firewall',
          type: 'rule',
          values: {
            name: `RouteLink: schedule ${MAC} 13:00-15:30`,
            src: '*',
            dest: '*',
            src_mac: [MAC],
            proto: 'all',
            target: 'REJECT',
            start_time: '13:00:00',
            stop_time: '15:30:00',
            weekdays: 'Mon Tue Wed Thu Fri',
          },
        },
      },
    ]);
  });

  it('splits a period across midnight so the morning part counts for the next day', () => {
    const changes = scheduleChanges(MAC, [{ days: [0, 4, 6], from: '21:00', to: '07:00' }], true);
    const values = changes.map((c) => (c.params as { values: Record<string, string> }).values);
    expect(values.map((v) => [v.start_time, v.stop_time, v.weekdays])).toEqual([
      ['21:00:00', '23:59:59', 'Sun Thu Sat'],
      // Saturday night ends on Sunday morning: the day after 6 is 0.
      ['00:00:00', '07:00:00', 'Sun Mon Fri'],
    ]);
    expect(new Set(values.map((v) => v.name))).toEqual(new Set([`RouteLink: schedule ${MAC} 21:00-07:00`]));
  });

  it('leaves out the weekdays for every day and skips an empty morning part', () => {
    const changes = scheduleChanges(MAC, [{ days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '00:00' }], true);
    expect(changes).toHaveLength(1);
    const v = (changes[0].params as { values: Record<string, string> }).values;
    expect(v.weekdays).toBeUndefined();
    expect([v.start_time, v.stop_time]).toEqual(['22:00:00', '23:59:59']);
  });

  it('marks the rules disabled and replaces the existing ones', () => {
    const existing = parseSchedules(asSections([{ days: [1], from: '20:00', to: '06:00' }])).get(MAC)!;
    const changes = scheduleChanges(MAC, [{ days: [2], from: '09:00', to: '10:00' }], false, existing);
    expect(changes.slice(0, 2)).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'r0' } },
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'r1' } },
    ]);
    expect((changes[2].params as { values: Record<string, string> }).values.enabled).toBe('0');
  });

  it('removes everything when no period is left', () => {
    const existing = parseSchedules(asSections([{ days: [1], from: '20:00', to: '21:00' }])).get(MAC)!;
    expect(scheduleChanges(MAC, [], true, existing)).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'r0' } },
    ]);
  });
});

describe('parseSchedules', () => {
  it('turns the rules back into the periods they came from', () => {
    const periods: BlockPeriod[] = [
      { days: [1, 2, 3, 4, 5], from: '07:30', to: '16:00' },
      { days: [0, 1, 2, 3, 4], from: '21:00', to: '07:00' },
      { days: [5, 6], from: '23:00', to: '08:00' },
    ];
    const schedule = parseSchedules(asSections(periods)).get(MAC)!;
    expect(schedule.enabled).toBe(true);
    expect(schedule.periods).toEqual([periods[0], periods[1], periods[2]]);
    expect(schedule.sections).toHaveLength(5);
  });

  it('merges periods with the same times and reads a disabled schedule', () => {
    const schedule = parseSchedules(
      asSections(
        [
          { days: [3], from: '18:00', to: '19:00' },
          { days: [1], from: '18:00', to: '19:00' },
        ],
        false,
      ),
    ).get(MAC)!;
    expect(schedule).toMatchObject({ enabled: false, periods: [{ days: [1, 3], from: '18:00', to: '19:00' }] });
  });

  it('ignores other rules, including the block rule', () => {
    const values: Record<string, UciSection> = {
      block: {
        '.name': 'block',
        '.type': 'rule',
        name: `RouteLink: block ${MAC}`,
        src_mac: [MAC],
        target: 'REJECT',
      },
      other: { '.name': 'other', '.type': 'rule', name: 'Allow-Ping', proto: 'icmp', target: 'ACCEPT' },
    };
    expect(parseSchedules(values).size).toBe(0);
  });

  it('marks the rules as managed on the firewall page', () => {
    const fw = parseFirewall(asSections([{ days: [1], from: '20:00', to: '21:00' }]));
    expect(fw.rules[0].managed).toBe(true);
  });
});

describe('validatePeriod', () => {
  it.each([
    [{ days: [1], from: '08:00', to: '09:00' }, null],
    [{ days: [], from: '08:00', to: '09:00' }, 'days'],
    [{ days: [1], from: '8:00', to: '09:00' }, 'time'],
    [{ days: [1], from: '08:00', to: '24:00' }, 'time'],
    [{ days: [1], from: '08:00', to: '08:00' }, 'same'],
  ] as const)('%j → %s', (period, error) => {
    expect(validatePeriod({ ...period, days: [...period.days] })).toBe(error);
  });
});

describe('activePeriod', () => {
  const periods: BlockPeriod[] = [
    { days: [1, 2, 3, 4, 5], from: '13:00', to: '15:00' },
    { days: [0], from: '21:00', to: '07:00' },
  ];
  it.each([
    [1, '13:00', 0],
    [1, '14:59', 0],
    [1, '15:00', null],
    [6, '14:00', null],
    [0, '22:00', 1],
    // Sunday night carries on into Monday morning.
    [1, '06:59', 1],
    [1, '07:00', null],
    [0, '06:00', null],
  ] as const)('day %i at %s → period %s', (weekday, time, index) => {
    const [h, m] = time.split(':').map(Number);
    const found = activePeriod(periods, weekday, h * 60 + m);
    expect(found).toBe(index === null ? null : periods[index]);
  });
});

describe('scheduleCron', () => {
  const mine = 'for a in';
  it('adds a flush at the start of every period and keeps the rest of the file', () => {
    const before = parseCrontab('0 4 * * * /sbin/reboot\n');
    const lines = scheduleCron(before, MAC, [
      { days: [1, 2, 3, 4, 5], from: '21:30', to: '07:00' },
      { days: [0, 1, 2, 3, 4, 5, 6], from: '13:00', to: '14:00' },
    ]);
    const text = serializeCrontab(lines);
    expect(text.split('\n').slice(0, 5)).toEqual([
      '0 4 * * * /sbin/reboot',
      `# RouteLink: schedule ${MAC}`,
      `0 13 * * * ${flushCommand(MAC)}`,
      `# RouteLink: schedule ${MAC}`,
      `30 21 * * 1,2,3,4,5 ${flushCommand(MAC)}`,
    ]);
    // Parsed back, the app's lines are marked as managed.
    expect(parseCrontab(text).filter((l) => l.kind === 'entry' && l.managed)).toHaveLength(2);
  });

  it('replaces its own lines and removes them for no periods', () => {
    const first = scheduleCron([], MAC, [{ days: [1], from: '20:00', to: '21:00' }]);
    const other = scheduleCron(first, 'AA:BB:CC:00:11:33', [{ days: [2], from: '20:00', to: '21:00' }]);
    const replaced = scheduleCron(other, MAC, [{ days: [3], from: '19:00', to: '21:00' }]);
    expect(serializeCrontab(replaced)).toContain(`0 19 * * 3 ${flushCommand(MAC)}`);
    expect(serializeCrontab(replaced)).not.toContain('0 20 * * 1');
    const removed = scheduleCron(replaced, MAC, null);
    expect(serializeCrontab(removed)).not.toContain(MAC);
    expect(serializeCrontab(removed)).toContain('AA:BB:CC:00:11:33');
    expect(serializeCrontab(removed)).toContain(mine);
  });

  it('flushes the connections of every address the device has', () => {
    expect(flushCommand(MAC)).toBe(
      `for a in $(ip neigh show | awk 'tolower($5)=="aa:bb:cc:00:11:22"{print $1}'); do echo $a > /proc/net/nf_conntrack; done 2>/dev/null`,
    );
  });
});

describe('getParental and saveSchedule', () => {
  it('reads the rules and the crontab together', async () => {
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.get.firewall', ok({ values: asSections([{ days: [1], from: '20:00', to: '21:00' }]) }))
      .override('file.read.etc-crontabs-root', ok({ data: '' }));
    const state = await getParental(conn);
    expect(state.schedules.get(MAC)?.periods).toEqual([{ days: [1], from: '20:00', to: '21:00' }]);
    expect(state.crontab.original).toBe('');
  });

  it('applies the rules, then writes the crontab', async () => {
    let crontab = '';
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.get.firewall', ok({ values: {} }))
      .override('file.read.etc-crontabs-root', () => ok({ data: crontab }))
      .override('file.write', (c) => {
        crontab = String((c.params as { data: string }).data);
        return ok({});
      })
      .override('file.exec', ok({ code: 0 }))
      .override('uci.add', ok({ section: 'cfg1' }))
      .override('uci.apply', ok({}))
      .override('uci.confirm', ok({}));
    const outcome = await saveSchedule(conn, MAC, [{ days: [1], from: '20:00', to: '21:00' }], true, {
      sleep: async () => {},
    });
    expect(outcome.status).toBe('confirmed');
    expect(crontab).toContain(`0 20 * * 1 ${flushCommand(MAC)}`);
    const order = conn.calls.map((c) => `${c.object}.${c.method}`);
    expect(order.indexOf('uci.confirm')).toBeLessThan(order.indexOf('file.write'));
  });

  it('leaves the crontab alone when the router rolled back', async () => {
    let now = 0;
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.get.firewall', ok({ values: {} }))
      .override('file.read.etc-crontabs-root', ok({ data: '' }))
      .override('uci.add', ok({ section: 'cfg1' }))
      .override('uci.apply', ok({}))
      .override('uci.confirm', () => {
        throw new NativeError('ERR_TIMEOUT', 'down');
      });
    const outcome = await saveSchedule(conn, MAC, [{ days: [1], from: '20:00', to: '21:00' }], true, {
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    });
    expect(outcome.status).toBe('rolled-back');
    expect(conn.calls.some((c) => c.object === 'file' && c.method === 'write')).toBe(false);
  });
});
