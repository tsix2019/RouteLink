import type { UciSection } from '../uci';
import { macFilterChanges, parseMacFilters, validateMacFilter, type MacFilter } from './macfilter';

const wireless: Record<string, UciSection> = {
  radio0: { '.name': 'radio0', '.type': 'wifi-device', band: '2g' },
  home: { '.name': 'home', '.type': 'wifi-iface', '.index': 1, device: 'radio0', mode: 'ap', ssid: 'Home' },
  iot: {
    '.name': 'iot',
    '.type': 'wifi-iface',
    '.index': 2,
    device: 'radio0',
    mode: 'ap',
    ssid: 'IoT',
    macfilter: 'allow',
    maclist: ['aa:bb:cc:00:00:01', 'AA-BB-CC-00-00-02'],
  },
  uplink: { '.name': 'uplink', '.type': 'wifi-iface', '.index': 3, device: 'radio0', mode: 'sta', ssid: 'Upstream' },
};

describe('parseMacFilters', () => {
  it('reads the filter of every access point', () => {
    expect(parseMacFilters(wireless)).toEqual([
      { section: 'home', ssid: 'Home', radio: 'radio0', mode: 'disable', macs: [] },
      { section: 'iot', ssid: 'IoT', radio: 'radio0', mode: 'allow', macs: ['AA:BB:CC:00:00:01', 'AA:BB:CC:00:00:02'] },
    ]);
  });
});

describe('validateMacFilter', () => {
  it('refuses lists that would lock out every device or this phone', () => {
    expect(validateMacFilter('allow', ['AA:BB:CC:00:00:01'], { phoneMac: 'AA:BB:CC:00:00:01' })).toBeNull();
    expect(validateMacFilter('allow', [], {})).toBe('allow-empty');
    expect(validateMacFilter('allow', ['AA:BB:CC:00:00:01'], { phoneMac: 'AA:BB:CC:00:00:09' })).toBe(
      'locks-out-phone',
    );
    expect(validateMacFilter('deny', ['AA:BB:CC:00:00:09'], { phoneMac: 'aa:bb:cc:00:00:09' })).toBe('locks-out-phone');
    expect(validateMacFilter('deny', ['nonsense'], {})).toBe('mac-invalid');
    expect(validateMacFilter('disable', [], { phoneMac: 'AA:BB:CC:00:00:09' })).toBeNull();
  });
});

describe('macFilterChanges', () => {
  const iot = (): MacFilter => parseMacFilters(wireless)[1];

  it('writes the mode and the normalised list', () => {
    expect(macFilterChanges(iot(), 'deny', ['aa-bb-cc-00-00-03', 'AA:BB:CC:00:00:03'])).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'wireless', section: 'iot', values: { macfilter: 'deny', maclist: ['AA:BB:CC:00:00:03'] } },
      },
    ]);
  });

  it('switching off keeps the list for later', () => {
    expect(macFilterChanges(iot(), 'disable', [])).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'wireless', section: 'iot', values: { macfilter: 'disable' } },
      },
    ]);
  });
});
