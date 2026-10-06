import type { Radio, WifiNetwork } from '@/api/services/wireless';

import { ssidTwins, syncPlan, twinsToChange } from './ssidSync';

const net = (section: string, over: Partial<WifiNetwork> = {}): WifiNetwork => ({
  section,
  radio: 'radio0',
  ifname: section === 'default_radio0' ? 'phy0-ap0' : 'phy1-ap0',
  ssid: 'Home',
  encryption: 'sae-mixed',
  key: 'old-password-1',
  hidden: false,
  disabled: false,
  network: ['lan'],
  mode: 'ap',
  up: true,
  ...over,
});

const radio = (name: string, band: Radio['band'], networks: WifiNetwork[]): Radio => ({
  name,
  band,
  channel: 'auto',
  disabled: false,
  up: true,
  networks,
});

const groups = [
  {
    routerId: 'gw',
    name: 'Gateway',
    radios: [
      radio('radio0', '2.4G', [net('default_radio0')]),
      radio('radio1', '5G', [net('default_radio1', { ssid: 'Home-5G' })]),
    ],
  },
  {
    routerId: 'ap1',
    name: 'Kitchen',
    radios: [
      radio('radio0', '2.4G', [
        net('default_radio0', { encryption: 'psk2' }),
        net('wwan', { mode: 'sta', ifname: 'phy0-sta0' }),
      ]),
      radio('radio1', '5G', [net('default_radio1', { ssid: 'Home-5G' })]),
    ],
  },
  { routerId: 'ap2', name: 'Offline AP' },
];

describe('ssidTwins', () => {
  it('finds same-name access points across the group, not itself and not client interfaces', () => {
    const twins = ssidTwins(groups, 'Home', { routerId: 'gw', section: 'default_radio0' });
    expect(twins.map((t) => [t.routerId, t.network.section, t.band])).toEqual([['ap1', 'default_radio0', '2.4G']]);
    expect(ssidTwins(groups, '', { routerId: 'gw', section: 'x' })).toEqual([]);
  });

  it('keeps only twins that differ from the new values', () => {
    const twins = ssidTwins(groups, 'Home-5G', { routerId: 'gw', section: 'default_radio1' });
    expect(twinsToChange(twins, { ssid: 'Home-5G', encryption: 'sae-mixed', key: 'old-password-1' })).toEqual([]);
    expect(twinsToChange(twins, { ssid: 'Home-5G', encryption: 'sae-mixed', key: 'new-password-2' })).toHaveLength(1);
  });
});

describe('syncPlan', () => {
  const primary = groups[0].radios![0].networks[0];
  const fields = { ssid: 'Home', encryption: 'sae-mixed', key: 'new-password-2' };
  const twins = ssidTwins(groups, 'Home', { routerId: 'gw', section: 'default_radio0' });
  const primaryChanges = [
    { object: 'uci', method: 'set', params: { config: 'wireless', section: 'default_radio0', values: { key: 'x' } } },
  ];

  it('aligns encryption and password on every twin, one apply per router', () => {
    const plan = syncPlan({ routerId: 'gw', network: primary, changes: primaryChanges }, twins, fields, () => false);
    expect(plan.map((s) => [s.routerId, s.mode, s.sections])).toEqual([
      ['gw', 'rollback', ['default_radio0']],
      ['ap1', 'rollback', ['default_radio0']],
    ]);
    expect(plan[1].changes[0].params).toMatchObject({ values: { encryption: 'sae-mixed', key: 'new-password-2' } });
  });

  it('applies the router the phone is on last, without rollback', () => {
    const plan = syncPlan(
      { routerId: 'gw', network: primary, changes: primaryChanges },
      twins,
      fields,
      (routerId, ifname) => routerId === 'gw' && ifname === 'phy0-ap0',
    );
    expect(plan.map((s) => [s.routerId, s.mode])).toEqual([
      ['ap1', 'rollback'],
      ['gw', 'direct'],
    ]);
  });
});
