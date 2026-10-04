import { FixtureConnection, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import type { Client } from './clients';
import { getRadios, isPhoneOnNetwork, networkChanges, parseRadios, radioChanges, scan, validateNetwork } from './wireless';

const status = (() => {
  const r = loadFixture('handmade', 'luci-rpc.getWirelessDevices');
  return (r.ok ? r.data : {}) as Record<string, never>;
})();

const config = {
  radio0: { '.name': 'radio0', '.type': 'wifi-device', type: 'mac80211', band: '2g', channel: '6', htmode: 'HE20', country: 'CN' },
  radio1: { '.name': 'radio1', '.type': 'wifi-device', type: 'mac80211', band: '5g', channel: 'auto', htmode: 'HE80', disabled: '0' },
  default_radio0: { '.name': 'default_radio0', '.type': 'wifi-iface', device: 'radio0', network: 'lan', mode: 'ap', ssid: 'RouteLink', encryption: 'sae-mixed', key: 'correct horse' },
  default_radio1: { '.name': 'default_radio1', '.type': 'wifi-iface', device: 'radio1', network: ['lan'], mode: 'ap', ssid: 'RouteLink-5G', encryption: 'psk2', key: 'correct horse', hidden: '1' },
} as unknown as Record<string, UciSection>;

describe('parseRadios', () => {
  it('merges runtime status with uci config', () => {
    const radios = parseRadios(status, config);
    expect(radios.map((r) => [r.name, r.band, r.channel, r.up])).toEqual([
      ['radio0', '2.4G', '6', true],
      ['radio1', '5G', 'auto', true],
    ]);
    expect(radios[0].networks[0]).toMatchObject({ section: 'default_radio0', ifname: 'phy0-ap0', ssid: 'RouteLink', encryption: 'sae-mixed', hidden: false, network: ['lan'], up: true });
    expect(radios[1].networks[0]).toMatchObject({ ssid: 'RouteLink-5G', hidden: true, ifname: 'phy1-ap0' });
  });

  it('lists configured but disabled radios that have no runtime status', () => {
    const radios = parseRadios({}, { radio0: { ...config.radio0, disabled: '1' } } as Record<string, UciSection>);
    expect(radios).toEqual([expect.objectContaining({ name: 'radio0', disabled: true, up: false, networks: [] })]);
  });
});

it('returns no radios on a router without Wi-Fi (24.10 Docker fixture)', async () => {
  await expect(getRadios(new FixtureConnection())).resolves.toEqual([]);
});

it('loads radios in one batch', async () => {
  const conn = new FixtureConnection()
    .override('luci-rpc.getWirelessDevices', ok(status))
    .override('uci.get.wireless', ok({ values: config }));
  const radios = await getRadios(conn);
  expect(radios).toHaveLength(2);
  expect(conn.calls).toHaveLength(2);
});

describe('change sets', () => {
  const [radio] = parseRadios(status, config);
  const net = radio.networks[0];

  it('stages only changed radio options', () => {
    expect(radioChanges(radio, { channel: '6', txpower: 17, disabled: true })).toEqual([
      { object: 'uci', method: 'set', params: { config: 'wireless', section: 'radio0', values: { txpower: '17', disabled: '1' } } },
    ]);
    expect(radioChanges(radio, { channel: '6' })).toEqual([]);
  });

  it('stages only changed network options', () => {
    expect(networkChanges(net, { ssid: 'Home', key: 'correct horse', hidden: true })).toEqual([
      { object: 'uci', method: 'set', params: { config: 'wireless', section: 'default_radio0', values: { ssid: 'Home', hidden: '1' } } },
    ]);
  });
});

describe('validateNetwork', () => {
  it.each([
    [{ ssid: 'Home', encryption: 'psk2', key: '12345678' }, []],
    [{ ssid: '', encryption: 'none' }, ['ssid-empty']],
    [{ ssid: '家里的无线网络家里的无线网络', encryption: 'none' }, ['ssid-too-long']],
    [{ ssid: 'Home', encryption: 'sae', key: '' }, ['key-required']],
    [{ ssid: 'Home', encryption: 'psk2', key: 'short' }, ['key-length']],
    [{ ssid: 'Open', encryption: 'owe' }, []],
  ])('%p → %p', (input, issues) => {
    expect(validateNetwork(input)).toEqual(issues);
  });
});

it('parses and sorts scan results', async () => {
  const conn = new FixtureConnection().override(
    'iwinfo.scan.phy0-ap0',
    ok({
      results: [
        { ssid: 'Weak', bssid: 'AA:00:00:00:00:01', channel: 1, signal: -80, encryption: { enabled: false } },
        { bssid: 'AA:00:00:00:00:02', channel: 11, signal: -40, encryption: { enabled: true, description: 'WPA2 PSK (CCMP)' } },
      ],
    }),
  );
  expect(await scan(conn, 'phy0-ap0')).toEqual([
    { ssid: '', bssid: 'AA:00:00:00:00:02', channel: 11, signal: -40, encryption: 'WPA2 PSK (CCMP)' },
    { ssid: 'Weak', bssid: 'AA:00:00:00:00:01', channel: 1, signal: -80, encryption: 'none' },
  ]);
});

describe('isPhoneOnNetwork', () => {
  const phone = { ipv4: '192.168.1.20', wifi: { ifname: 'phy0-ap0' } } as Client;
  it('is true only when the phone is a station of that interface', () => {
    expect(isPhoneOnNetwork('192.168.1.20', [phone], 'phy0-ap0')).toBe(true);
    expect(isPhoneOnNetwork('192.168.1.20', [phone], 'phy1-ap0')).toBe(false);
    expect(isPhoneOnNetwork('192.168.1.99', [phone], 'phy0-ap0')).toBe(false);
    expect(isPhoneOnNetwork(null, [phone], 'phy0-ap0')).toBe(false);
  });
});
