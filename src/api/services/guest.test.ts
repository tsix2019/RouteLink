import type { UciSection } from '../uci';
import {
  createGuestChanges,
  deleteGuestChanges,
  freeGuestAddress,
  guestSupport,
  guestWifiChanges,
  parseGuest,
  type GuestConfigs,
  type GuestInput,
} from './guest';

const s = (name: string, type: string, values: Record<string, string | string[]>): UciSection =>
  ({ '.name': name, '.type': type, ...values }) as UciSection;

const wireless = {
  radio0: s('radio0', 'wifi-device', { band: '2g' }),
  radio1: s('radio1', 'wifi-device', { band: '5g' }),
  default_radio0: s('default_radio0', 'wifi-iface', { device: 'radio0', network: 'lan', ssid: 'Home', mode: 'ap' }),
};
const firewall = {
  lanz: s('lanz', 'zone', { name: 'lan', network: ['lan'] }),
  wanz: s('wanz', 'zone', { name: 'wan', network: ['wan', 'wan6'], masq: '1' }),
};

describe('guestSupport', () => {
  it('needs radios and a masquerading zone', () => {
    expect(guestSupport(wireless, firewall)).toEqual({ status: 'ok', wanZone: 'wan' });
    expect(guestSupport({}, firewall)).toEqual({ status: 'no-wifi' });
    // An access point: Wi-Fi, but the routing happens on another router.
    expect(guestSupport(wireless, { lanz: firewall.lanz })).toEqual({ status: 'not-gateway' });
  });
});

describe('freeGuestAddress', () => {
  it('takes the first free 192.168.x.1/24', () => {
    expect(freeGuestAddress([{ ipaddr: '192.168.1.1', prefix: 24 }])).toBe('192.168.3.1');
    expect(
      freeGuestAddress([
        { ipaddr: '192.168.3.1', prefix: 24 },
        { ipaddr: '192.168.4.20', prefix: 22 },
      ]),
    ).toBe('192.168.8.1');
  });
});

const input = (patch: Partial<GuestInput> = {}): GuestInput => ({
  ssid: 'Home-Guest',
  encryption: 'sae-mixed',
  key: 'welcome-2026',
  radios: ['radio0', 'radio1'],
  ipaddr: '192.168.3.1',
  isolate: true,
  ...patch,
});

describe('createGuestChanges', () => {
  it('builds the network, Wi-Fi, DHCP and firewall sections OpenWrt’s guide describes', () => {
    const calls = createGuestChanges(input(), { style: 'netmask', wanZone: 'wan' });
    const added = calls.map((c) => [c.params?.config, c.params?.type, c.params?.name]);
    expect(added).toEqual([
      ['network', 'device', 'guest_dev'],
      ['network', 'interface', 'guest'],
      ['wireless', 'wifi-iface', 'guest_radio0'],
      ['wireless', 'wifi-iface', 'guest_radio1'],
      ['dhcp', 'dhcp', 'guest'],
      ['firewall', 'zone', 'guest'],
      ['firewall', 'forwarding', 'guest_wan'],
      ['firewall', 'rule', 'guest_dns'],
      ['firewall', 'rule', 'guest_dhcp'],
    ]);
    expect(calls[1].params?.values).toEqual({
      proto: 'static',
      device: 'br-guest',
      ipaddr: '192.168.3.1',
      netmask: '255.255.255.0',
    });
    expect(calls[2].params?.values).toEqual({
      device: 'radio0',
      mode: 'ap',
      network: 'guest',
      ssid: 'Home-Guest',
      encryption: 'sae-mixed',
      key: 'welcome-2026',
      isolate: '1',
    });
    expect(calls[5].params?.values).toEqual({
      name: 'guest',
      network: ['guest'],
      input: 'REJECT',
      output: 'ACCEPT',
      forward: 'REJECT',
    });
    expect(calls[6].params?.values).toEqual({ src: 'guest', dest: 'wan' });
  });

  it('writes the address as a CIDR list on 25.12 and leaves the key out of open networks', () => {
    const calls = createGuestChanges(input({ encryption: 'none', key: '', isolate: false, radios: ['radio1'] }), {
      style: 'cidr-list',
      wanZone: 'wan',
    });
    expect(calls[1].params?.values).toEqual({ proto: 'static', device: 'br-guest', ipaddr: ['192.168.3.1/24'] });
    expect(calls[2].params?.values).toEqual({
      device: 'radio1',
      mode: 'ap',
      network: 'guest',
      ssid: 'Home-Guest',
      encryption: 'none',
    });
  });
});

const created: GuestConfigs = {
  network: {
    lan: s('lan', 'interface', { proto: 'static', ipaddr: '192.168.1.1', netmask: '255.255.255.0' }),
    guest_dev: s('guest_dev', 'device', { type: 'bridge', name: 'br-guest' }),
    guest: s('guest', 'interface', {
      proto: 'static',
      device: 'br-guest',
      ipaddr: '192.168.3.1',
      netmask: '255.255.255.0',
    }),
  },
  wireless: {
    ...wireless,
    guest_radio0: s('guest_radio0', 'wifi-iface', {
      device: 'radio0',
      network: 'guest',
      ssid: 'Home-Guest',
      encryption: 'sae-mixed',
      key: 'k',
      isolate: '1',
    }),
    guest_radio1: s('guest_radio1', 'wifi-iface', {
      device: 'radio1',
      network: 'guest',
      ssid: 'Home-Guest',
      encryption: 'sae-mixed',
      key: 'k',
      disabled: '1',
    }),
  },
  dhcp: { guest: s('guest', 'dhcp', { interface: 'guest', start: '100', limit: '150', leasetime: '1h' }) },
  firewall: {
    ...firewall,
    guest: s('guest', 'zone', { name: 'guest', network: ['guest'] }),
    guest_wan: s('guest_wan', 'forwarding', { src: 'guest', dest: 'wan' }),
    guest_dns: s('guest_dns', 'rule', { name: 'Allow-DNS-Guest' }),
  },
};

describe('parseGuest', () => {
  it('finds the guest network and its Wi-Fi', () => {
    expect(parseGuest(created)).toEqual({
      ipaddr: '192.168.3.1',
      prefix: 24,
      wifi: [
        {
          section: 'guest_radio0',
          radio: 'radio0',
          ssid: 'Home-Guest',
          encryption: 'sae-mixed',
          key: 'k',
          disabled: false,
          isolate: true,
        },
        {
          section: 'guest_radio1',
          radio: 'radio1',
          ssid: 'Home-Guest',
          encryption: 'sae-mixed',
          key: 'k',
          disabled: true,
          isolate: false,
        },
      ],
    });
    expect(parseGuest({ network: {}, wireless, dhcp: {}, firewall })).toBeNull();
  });
});

describe('switching and removing', () => {
  it('switches every guest Wi-Fi on or off', () => {
    const guest = parseGuest(created)!;
    expect(guestWifiChanges(guest, true)).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'wireless', section: 'guest_radio0', values: { disabled: '0' } },
      },
      {
        object: 'uci',
        method: 'set',
        params: { config: 'wireless', section: 'guest_radio1', values: { disabled: '0' } },
      },
    ]);
  });

  it('removes exactly the sections that exist', () => {
    expect(deleteGuestChanges(created).map((c) => `${c.params?.config}.${c.params?.section}`)).toEqual([
      'network.guest_dev',
      'network.guest',
      'wireless.guest_radio0',
      'wireless.guest_radio1',
      'dhcp.guest',
      'firewall.guest',
      'firewall.guest_wan',
      'firewall.guest_dns',
    ]);
  });
});
