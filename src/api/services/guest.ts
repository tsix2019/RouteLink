import { intToIp, ipToInt, netmaskToPrefix, parsePrefix, prefixContains } from '@/utils/net';

import { uci, type UciSection, type UciValues } from '../uci';
import type { UbusCall } from '../ubus/types';

/**
 * Guest Wi-Fi (WL-5), built the way OpenWrt's "Guest Wi-Fi" guide does it: a bridge and an interface
 * with its own subnet, an access point per radio, a DHCP pool, and a firewall zone that may reach the
 * internet but neither the LAN nor the router (apart from DNS and DHCP). All sections have fixed names
 * (guest, guest_dev, guest_<radio>, guest_wan, guest_dns, guest_dhcp), so removing takes exactly them.
 */

export type GuestConfigs = Record<'network' | 'wireless' | 'dhcp' | 'firewall', Record<string, UciSection>>;

export type GuestSupport = { status: 'ok'; wanZone: string } | { status: 'no-wifi' } | { status: 'not-gateway' };

const ofType = (values: Record<string, UciSection>, type: string) =>
  Object.values(values).filter((s) => s['.type'] === type);

/** Only on routers that have radios and route to the internet themselves (a masquerading zone). */
export function guestSupport(wireless: Record<string, UciSection>, firewall: Record<string, UciSection>): GuestSupport {
  if (!ofType(wireless, 'wifi-device').length) return { status: 'no-wifi' };
  const wan = ofType(firewall, 'zone').find((z) => z.masq === '1');
  return wan ? { status: 'ok', wanZone: String(wan.name ?? 'wan') } : { status: 'not-gateway' };
}

/** The first 192.168.x.1/24 (x from 3) that overlaps none of the router's subnets. */
export function freeGuestAddress(taken: { ipaddr: string; prefix: number }[]): string {
  for (let x = 3; x < 255; x++) {
    const candidate = `192.168.${x}.1`;
    const clash = taken.some((t) => {
      const shorter = Math.min(t.prefix, 24);
      return prefixContains(`${t.ipaddr}/${shorter}`, candidate);
    });
    if (!clash) return candidate;
  }
  return '10.233.3.1';
}

export interface GuestWifi {
  section: string;
  radio: string;
  ssid: string;
  encryption: string;
  key?: string;
  disabled: boolean;
  isolate: boolean;
}

export interface GuestNetwork {
  ipaddr?: string;
  prefix?: number;
  wifi: GuestWifi[];
}

/** The guest network, or null when there is none. */
export function parseGuest(c: GuestConfigs): GuestNetwork | null {
  const iface = c.network.guest;
  if (!iface || iface['.type'] !== 'interface') return null;
  const guest: GuestNetwork = {
    wifi: ofType(c.wireless, 'wifi-iface')
      .filter((w) => w.network === 'guest' || (Array.isArray(w.network) && w.network.includes('guest')))
      .map((w) => {
        const wifi: GuestWifi = {
          section: w['.name'],
          radio: String(w.device ?? ''),
          ssid: String(w.ssid ?? ''),
          encryption: String(w.encryption ?? 'none'),
          disabled: w.disabled === '1',
          isolate: w.isolate === '1',
        };
        if (typeof w.key === 'string') wifi.key = w.key;
        return wifi;
      }),
  };
  const first = (Array.isArray(iface.ipaddr) ? iface.ipaddr[0] : iface.ipaddr) as string | undefined;
  if (first?.includes('/')) {
    const p = parsePrefix(first);
    if (p) Object.assign(guest, { ipaddr: p.address, prefix: p.prefix });
  } else if (first) {
    let prefix = 24;
    try {
      if (typeof iface.netmask === 'string') prefix = netmaskToPrefix(iface.netmask);
    } catch {
      // keep /24
    }
    Object.assign(guest, { ipaddr: first, prefix });
  }
  return guest;
}

export interface GuestInput {
  ssid: string;
  /** sae-mixed (WPA2/WPA3), psk2 (WPA2) or none. */
  encryption: 'sae-mixed' | 'psk2' | 'none';
  key: string;
  /** wifi-device sections to put the guest network on. */
  radios: string[];
  /** Router address on the guest subnet (/24). */
  ipaddr: string;
  /** Guests can't see each other. */
  isolate: boolean;
}

export function createGuestChanges(
  input: GuestInput,
  o: { style: 'netmask' | 'cidr-list' | 'cidr'; wanZone: string },
): UbusCall[] {
  const address: UciValues =
    o.style === 'netmask'
      ? { ipaddr: input.ipaddr, netmask: '255.255.255.0' }
      : { ipaddr: o.style === 'cidr-list' ? [`${input.ipaddr}/24`] : `${input.ipaddr}/24` };
  const wifi = (radio: string): UbusCall => {
    const values: UciValues = {
      device: radio,
      mode: 'ap',
      network: 'guest',
      ssid: input.ssid,
      encryption: input.encryption,
    };
    if (input.encryption !== 'none') values.key = input.key;
    if (input.isolate) values.isolate = '1';
    return uci.add('wireless', 'wifi-iface', values, `guest_${radio}`);
  };
  return [
    uci.add('network', 'device', { type: 'bridge', name: 'br-guest', bridge_empty: '1' }, 'guest_dev'),
    uci.add('network', 'interface', { proto: 'static', device: 'br-guest', ...address }, 'guest'),
    ...input.radios.map(wifi),
    uci.add('dhcp', 'dhcp', { interface: 'guest', start: '100', limit: '150', leasetime: '1h' }, 'guest'),
    uci.add(
      'firewall',
      'zone',
      { name: 'guest', network: ['guest'], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' },
      'guest',
    ),
    uci.add('firewall', 'forwarding', { src: 'guest', dest: o.wanZone }, 'guest_wan'),
    uci.add(
      'firewall',
      'rule',
      { name: 'Allow-DNS-Guest', src: 'guest', dest_port: '53', proto: 'tcp udp', target: 'ACCEPT' },
      'guest_dns',
    ),
    uci.add(
      'firewall',
      'rule',
      { name: 'Allow-DHCP-Guest', src: 'guest', dest_port: '67', proto: 'udp', family: 'ipv4', target: 'ACCEPT' },
      'guest_dhcp',
    ),
  ];
}

export const guestWifiChanges = (guest: GuestNetwork, enabled: boolean): UbusCall[] =>
  guest.wifi.map((w) => uci.set('wireless', w.section, { disabled: enabled ? '0' : '1' }));

/** Removes the sections the guest network consists of, whichever of them exist. */
export function deleteGuestChanges(c: GuestConfigs): UbusCall[] {
  const named: [keyof GuestConfigs, string][] = [
    ['network', 'guest_dev'],
    ['network', 'guest'],
    ...ofType(c.wireless, 'wifi-iface')
      .filter((w) => w.network === 'guest')
      .map((w): [keyof GuestConfigs, string] => ['wireless', w['.name']]),
    ['dhcp', 'guest'],
    ['firewall', 'guest'],
    ['firewall', 'guest_wan'],
    ['firewall', 'guest_dns'],
    ['firewall', 'guest_dhcp'],
  ];
  return named.filter(([config, name]) => c[config][name]).map(([config, name]) => uci.del(config, name));
}

/** IPv4 subnets in use (interfaces with a static address), for picking the guest subnet. */
export function takenSubnets(network: Record<string, UciSection>): { ipaddr: string; prefix: number }[] {
  return ofType(network, 'interface').flatMap((s) => {
    const first = (Array.isArray(s.ipaddr) ? s.ipaddr[0] : s.ipaddr) as string | undefined;
    if (!first) return [];
    if (first.includes('/')) {
      const p = parsePrefix(first);
      return p && p.family === 4 ? [{ ipaddr: p.address, prefix: p.prefix }] : [];
    }
    try {
      ipToInt(first);
      return [{ ipaddr: first, prefix: typeof s.netmask === 'string' ? netmaskToPrefix(s.netmask) : 32 }];
    } catch {
      return [];
    }
  });
}

export const guestNetworkAddress = (ipaddr: string) => intToIp((ipToInt(ipaddr) & 0xffffff00) >>> 0);
