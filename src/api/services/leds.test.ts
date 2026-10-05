import { FixtureConnection, ok } from '../../../test/fixture-connection';
import { getLeds, ledChanges, type Led } from './leds';

const leds = {
  'green:power': { brightness: 255, max_brightness: 255, triggers: ['none', 'timer', 'default-on', 'netdev'], active_trigger: 'default-on' },
  'green:wan': { brightness: 0, max_brightness: 1, triggers: ['none', 'netdev', 'heartbeat'], active_trigger: 'netdev' },
};
const system = {
  values: {
    cfg01e48a: { '.name': 'cfg01e48a', '.type': 'system', hostname: 'OpenWrt' },
    led_wan: { '.name': 'led_wan', '.type': 'led', name: 'WAN', sysfs: 'green:wan', trigger: 'netdev', dev: 'eth1', mode: 'link tx rx' },
  },
};

const conn = () =>
  new FixtureConnection('none').override('luci.getLEDs', ok(leds)).override('uci.get.system', ok(system));

describe('getLeds', () => {
  it('merges the kernel LEDs with their uci sections', async () => {
    const list = await getLeds(conn());
    expect(list).toEqual([
      {
        sysfs: 'green:power',
        on: true,
        trigger: 'default-on',
        triggers: ['none', 'timer', 'default-on', 'netdev'],
      },
      {
        sysfs: 'green:wan',
        on: false,
        trigger: 'netdev',
        triggers: ['none', 'netdev', 'heartbeat'],
        section: 'led_wan',
        name: 'WAN',
        dev: 'eth1',
        mode: ['link', 'tx', 'rx'],
      },
    ]);
  });

  it('is empty on routers without LEDs', async () => {
    const none = new FixtureConnection('none').override('luci.getLEDs', ok({})).override('uci.get.system', ok(system));
    expect(await getLeds(none)).toEqual([]);
  });
});

describe('ledChanges', () => {
  const wan = (): Led => ({
    sysfs: 'green:wan',
    on: false,
    trigger: 'netdev',
    triggers: [],
    section: 'led_wan',
    name: 'WAN',
  });

  it('switches a LED off or on with the none trigger and a default', () => {
    expect(ledChanges(wan(), { trigger: 'none', on: false })).toEqual([
      { object: 'uci', method: 'set', params: { config: 'system', section: 'led_wan', values: { trigger: 'none', default: '0' } } },
    ]);
  });

  it('adds a section for a LED that has none', () => {
    const power: Led = { sysfs: 'green:power', on: true, trigger: 'default-on', triggers: [] };
    expect(ledChanges(power, { trigger: 'heartbeat' })).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: { config: 'system', type: 'led', values: { name: 'green:power', sysfs: 'green:power', trigger: 'heartbeat' } },
      },
    ]);
  });

  it('sets the netdev interface and modes', () => {
    expect(ledChanges(wan(), { trigger: 'netdev', dev: 'eth0', mode: ['link', 'rx'] })[0].params).toMatchObject({
      values: { trigger: 'netdev', dev: 'eth0', mode: 'link rx' },
    });
  });
});
