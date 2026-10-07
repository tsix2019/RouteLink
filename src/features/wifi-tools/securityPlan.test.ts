import { DemoApConnection, DemoConnection } from '@/api/connection/demo/connection';
import { getRadios, type Radio, type WifiNetwork } from '@/api/services/wireless';
import type { RouterRadios } from '@/features/wireless/ssidSync';

import { parseWifiFeatures } from './security';
import { checkGroup, encryptionAfter, planFix } from './securityPlan';

const NOW = 1_800_000_000_000;

async function demoGroup(): Promise<{ groups: RouterRadios[]; features: Record<string, { sae?: boolean }> }> {
  const conn = new DemoConnection(2026, () => NOW, 0);
  const ap = new DemoApConnection(conn);
  return {
    groups: [
      { routerId: 'gw', name: 'Gateway', radios: await getRadios(conn) },
      { routerId: 'ap', name: 'AP', radios: await getRadios(ap) },
    ],
    features: {
      gw: parseWifiFeatures(await conn.call('luci', 'getFeatures')),
      ap: parseWifiFeatures(await ap.call('luci', 'getFeatures')),
    },
  };
}

const net = (section: string, o: Partial<WifiNetwork> = {}): WifiNetwork => ({
  section,
  radio: 'radio0',
  ifname: 'phy0-ap0',
  ssid: 'Home',
  encryption: 'psk2',
  key: 'correct-Horse-battery-9',
  hidden: false,
  disabled: false,
  network: ['lan'],
  mode: 'ap',
  up: true,
  ...o,
});
const radio = (name: string, networks: WifiNetwork[], o: Partial<Radio> = {}): Radio => ({
  name,
  band: name === 'radio0' ? '2.4G' : '5G',
  channel: 'auto',
  disabled: false,
  up: true,
  networks,
  ...o,
});

describe('checkGroup', () => {
  it('rates every enabled network of the demo group, worst first, and marks the phone’s', async () => {
    const { groups, features } = await demoGroup();
    const checks = checkGroup(groups, features, (routerId, ifname) => routerId === 'ap' && ifname === 'phy0-ap0');
    expect(checks.length).toBeGreaterThanOrEqual(4);
    const levels = ['danger', 'low', 'medium', 'high'];
    expect(checks.map((c) => levels.indexOf(c.level))).toEqual(
      [...checks.map((c) => levels.indexOf(c.level))].sort((a, b) => a - b),
    );
    const apRouteLink = checks.find((c) => c.routerId === 'ap' && c.ssid === 'RouteLink')!;
    expect(apRouteLink.phone).toBe(true);
    expect(apRouteLink.findings.map((f) => f.kind)).toEqual(['password', 'wps', 'mfp-off']);
    expect(apRouteLink.fixes).toContain('upgrade-wpa3');
    expect(checks.filter((c) => c.phone)).toHaveLength(1);
  });

  it('skips disabled radios and networks, and routers without radios', () => {
    const groups: RouterRadios[] = [
      {
        routerId: 'gw',
        name: 'G',
        radios: [
          radio('radio0', [net('a'), net('b', { disabled: true }), net('c', { mode: 'sta' })]),
          radio('radio1', [net('d')], { disabled: true }),
        ],
      },
      { routerId: 'ap', name: 'A' },
    ];
    expect(checkGroup(groups, {}, () => false).map((c) => c.section)).toEqual(['a']);
  });
});

describe('planFix', () => {
  const home24 = net('home24', { encryption: 'psk2', key: 'home-1234', wps: true });
  const home5 = net('home5', { radio: 'radio1', ifname: 'phy1-ap0', key: 'home-1234' });
  const apHome = net('ap_home', { key: 'home-1234' });
  const groups: RouterRadios[] = [
    { routerId: 'gw', name: 'G', radios: [radio('radio0', [home24]), radio('radio1', [home5])] },
    { routerId: 'ap', name: 'A', radios: [radio('radio0', [apHome])] },
  ];
  const check = { routerId: 'gw', network: home24 };

  it('upgrades and renews the password everywhere the SSID is, the phone’s router last without rollback', () => {
    const plan = planFix(
      check,
      ['upgrade-wpa3', 'new-password', 'disable-wps'],
      'Kx7m-Qp3t-Wn8r-Hd2v',
      groups,
      (routerId, ifname) => routerId === 'ap' && ifname === 'phy0-ap0',
      true,
    );
    expect(plan.twins.map((t) => t.network.section)).toEqual(['home5', 'ap_home']);
    expect(plan.steps.map((s) => [s.routerId, s.mode, s.sections])).toEqual([
      ['gw', 'rollback', ['home24', 'home5']],
      ['ap', 'direct', ['ap_home']],
    ]);
    expect(plan.steps[0].changes[0]).toMatchObject({
      params: {
        section: 'home24',
        values: { encryption: 'sae-mixed', ieee80211w: '1', key: 'Kx7m-Qp3t-Wn8r-Hd2v', wps_pushbutton: '0' },
      },
    });
    expect(plan).toMatchObject({ phoneDrops: true, rejoin: true, newKey: true });
  });

  it('changes only this network without the sync', () => {
    const plan = planFix(check, ['upgrade-wpa3'], undefined, groups, () => false, false);
    expect(plan.twins).toHaveLength(2);
    expect(plan.steps).toHaveLength(1);
    expect(plan).toMatchObject({ phoneDrops: false, rejoin: false, newKey: false });
  });

  it('needs no sync and no rejoin for fixes that leave the credentials alone', () => {
    const plan = planFix(check, ['disable-wps', 'enable-mfp'], undefined, groups, () => true, true);
    expect(plan.twins).toEqual([]);
    expect(plan.steps.map((s) => s.mode)).toEqual(['direct']);
    expect(plan).toMatchObject({ phoneDrops: true, rejoin: false });
  });
});

it('knows the encryption after the fixes', () => {
  expect(encryptionAfter(net('a'), ['upgrade-wpa3', 'new-password'])).toBe('sae-mixed');
  expect(encryptionAfter(net('a', { encryption: 'none' }), ['upgrade-wpa2'])).toBe('psk2+ccmp');
  expect(encryptionAfter(net('a'), ['disable-wps'])).toBe('psk2');
});
