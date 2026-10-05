import { FixtureConnection, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  clientConfig,
  createInterfaceChanges,
  deleteInterfaceChanges,
  editInterfaceChanges,
  generateKeyPair,
  getWgConfig,
  isWgKey,
  nextPeerAddress,
  parseWgConfig,
  peerChanges,
  suggestInterface,
  validatePeer,
  validateWgInterface,
  type WgInterfaceInput,
  type WgPeerInput,
} from './wireguard-config';

const KEY = (c: string) => `${c.repeat(42)}A=`;
const sec = (name: string, type: string, values: Record<string, string | string[]>, index = 0): UciSection => ({
  '.name': name,
  '.type': type,
  '.index': index,
  ...values,
});
const byName = (...s: UciSection[]) => Object.fromEntries(s.map((x) => [x['.name'], x]));

const network = byName(
  sec('lan', 'interface', { device: 'br-lan', proto: 'static', ipaddr: '192.168.8.1', netmask: '255.255.255.0' }, 1),
  sec('wan', 'interface', { device: 'eth0', proto: 'pppoe' }, 2),
  sec(
    'wg0',
    'interface',
    { proto: 'wireguard', private_key: KEY('s'), listen_port: '51820', addresses: ['10.8.0.1/24'] },
    3,
  ),
  sec(
    'cfg_phone',
    'wireguard_wg0',
    {
      description: 'Phone',
      public_key: KEY('p'),
      private_key: KEY('q'),
      preshared_key: KEY('k'),
      allowed_ips: ['10.8.0.2/32'],
      persistent_keepalive: '25',
    },
    4,
  ),
  sec(
    'cfg_office',
    'wireguard_wg0',
    {
      description: 'Office',
      public_key: KEY('o'),
      allowed_ips: ['10.8.0.3/32', '10.20.0.0/16'],
      route_allowed_ips: '1',
      endpoint_host: 'office.example.com',
      endpoint_port: '51820',
    },
    5,
  ),
);
const firewall = byName(
  sec(
    'cfg_lan',
    'zone',
    { name: 'lan', network: ['lan', 'wg0'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' },
    1,
  ),
  sec('cfg_wan', 'zone', { name: 'wan', network: ['wan', 'wan6'], input: 'REJECT', masq: '1' }, 2),
  sec(
    'cfg_wgrule',
    'rule',
    { name: 'RouteLink: WireGuard wg0', src: 'wan', proto: 'udp', dest_port: '51820', target: 'ACCEPT' },
    3,
  ),
);

describe('parseWgConfig', () => {
  it('reads interfaces with their peers, zone and port rule', () => {
    const [wg0] = parseWgConfig(network, firewall);
    expect(wg0).toMatchObject({
      name: 'wg0',
      privateKey: KEY('s'),
      listenPort: '51820',
      addresses: ['10.8.0.1/24'],
      zone: 'lan',
      zoneSection: 'cfg_lan',
      portRule: 'cfg_wgrule',
    });
    expect(wg0.peers).toEqual([
      {
        section: 'cfg_phone',
        name: 'Phone',
        publicKey: KEY('p'),
        privateKey: KEY('q'),
        presharedKey: KEY('k'),
        allowedIps: ['10.8.0.2/32'],
        keepalive: '25',
        routeAllowedIps: false,
        disabled: false,
      },
      {
        section: 'cfg_office',
        name: 'Office',
        publicKey: KEY('o'),
        allowedIps: ['10.8.0.3/32', '10.20.0.0/16'],
        endpointHost: 'office.example.com',
        endpointPort: '51820',
        routeAllowedIps: true,
        disabled: false,
      },
    ]);
  });

  it('reads the QEMU recording', () => {
    const values = (
      loadFixture('openwrt-24.10.8', 'uci.get.network') as { data: { values: Record<string, UciSection> } }
    ).data.values;
    const [wg0] = parseWgConfig(values, {});
    expect(wg0.peers.map((p) => p.name)).toEqual(['Test peer']);
    expect(wg0.zone).toBeUndefined();
  });
});

describe('interfaces', () => {
  const input: WgInterfaceInput = {
    name: 'wg1',
    privateKey: KEY('n'),
    listenPort: '51821',
    addresses: '10.9.0.1/24',
    mtu: '',
    joinLan: true,
    openPort: true,
  };

  it('suggests a free name, port and subnet', () => {
    expect(suggestInterface(parseWgConfig(network, firewall), network)).toEqual({
      name: 'wg1',
      listenPort: '51821',
      addresses: '10.9.0.1/24',
    });
    expect(suggestInterface([], byName(network.lan))).toEqual({
      name: 'wg0',
      listenPort: '51820',
      addresses: '10.8.0.1/24',
    });
  });

  it('validates name, port, addresses and overlaps', () => {
    const existing = parseWgConfig(network, firewall);
    expect(validateWgInterface(input, existing, network)).toEqual({});
    expect(
      validateWgInterface(
        { ...input, name: 'wan', listenPort: '51820', addresses: '192.168.8.10/24', mtu: '100' },
        existing,
        network,
      ),
    ).toEqual({ name: 'name-taken', listenPort: 'port-taken', addresses: 'address-overlap', mtu: 'mtu-invalid' });
    expect(
      validateWgInterface({ ...input, name: 'wg 1', listenPort: '0', addresses: '10.9.0.1' }, existing, network),
    ).toEqual({ name: 'name-invalid', listenPort: 'port-invalid', addresses: 'address-invalid' });
  });

  it('creates the interface, joins the LAN zone and opens the port on the WAN', () => {
    expect(createInterfaceChanges(input, firewall)).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'network',
          type: 'interface',
          name: 'wg1',
          values: { proto: 'wireguard', private_key: KEY('n'), listen_port: '51821', addresses: ['10.9.0.1/24'] },
        },
      },
      {
        object: 'uci',
        method: 'set',
        params: { config: 'firewall', section: 'cfg_lan', values: { network: ['lan', 'wg0', 'wg1'] } },
      },
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'firewall',
          type: 'rule',
          values: { name: 'RouteLink: WireGuard wg1', src: 'wan', proto: 'udp', dest_port: '51821', target: 'ACCEPT' },
        },
      },
    ]);
    expect(createInterfaceChanges({ ...input, joinLan: false, openPort: false, mtu: '1380' }, firewall)).toHaveLength(
      1,
    );
  });

  it('edits port and addresses, and moves the port rule along', () => {
    const [wg0] = parseWgConfig(network, firewall);
    expect(
      editInterfaceChanges(wg0, {
        ...input,
        name: 'wg0',
        privateKey: KEY('s'),
        listenPort: '51900',
        addresses: '10.8.0.1/24 fd00:8::1/64',
        mtu: '1380',
      }),
    ).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'network',
          section: 'wg0',
          values: {
            private_key: KEY('s'),
            listen_port: '51900',
            addresses: ['10.8.0.1/24', 'fd00:8::1/64'],
            mtu: '1380',
          },
        },
      },
      {
        object: 'uci',
        method: 'set',
        params: { config: 'firewall', section: 'cfg_wgrule', values: { dest_port: '51900' } },
      },
    ]);
  });

  it('deletes the interface with its peers, zone membership and port rule', () => {
    const [wg0] = parseWgConfig(network, firewall);
    expect(deleteInterfaceChanges(wg0, firewall)).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg_phone' } },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg_office' } },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'wg0' } },
      {
        object: 'uci',
        method: 'set',
        params: { config: 'firewall', section: 'cfg_lan', values: { network: ['lan'] } },
      },
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'cfg_wgrule' } },
    ]);
  });
});

describe('peers', () => {
  const [wg0] = parseWgConfig(network, firewall);
  const input: WgPeerInput = {
    name: 'Laptop',
    publicKey: KEY('l'),
    privateKey: KEY('m'),
    presharedKey: '',
    allowedIps: '10.8.0.4/32',
    endpointHost: '',
    endpointPort: '',
    keepalive: '25',
    routeAllowedIps: false,
  };

  it('gives the next free address in the tunnel', () => {
    expect(nextPeerAddress(wg0)).toBe('10.8.0.4/32');
    expect(nextPeerAddress({ ...wg0, addresses: ['fd00:8::1/64'] })).toBeNull();
  });

  it('validates keys, addresses, endpoint and keepalive', () => {
    expect(validatePeer(input, wg0)).toEqual({});
    expect(isWgKey(KEY('l'))).toBe(true);
    expect(isWgKey('abc=')).toBe(false);
    expect(
      validatePeer(
        {
          ...input,
          publicKey: 'nope',
          allowedIps: '10.8.0.2/32 bad',
          endpointHost: 'x',
          endpointPort: '99999',
          keepalive: '70000',
        },
        wg0,
      ),
    ).toEqual({
      publicKey: 'key-invalid',
      allowedIps: 'address-invalid',
      endpointPort: 'port-invalid',
      keepalive: 'keepalive-invalid',
    });
    // Another peer already routes 10.8.0.2.
    expect(validatePeer({ ...input, allowedIps: '10.8.0.2/32' }, wg0)).toEqual({ allowedIps: 'address-taken' });
  });

  it('adds a peer section named after the interface and keeps the private key for the export', () => {
    expect(peerChanges(wg0, input)).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'network',
          type: 'wireguard_wg0',
          values: {
            description: 'Laptop',
            public_key: KEY('l'),
            private_key: KEY('m'),
            allowed_ips: ['10.8.0.4/32'],
            persistent_keepalive: '25',
          },
        },
      },
    ]);
  });

  it('edits a peer and drops the options that were cleared', () => {
    const phone = wg0.peers[0];
    expect(
      peerChanges(
        wg0,
        {
          ...input,
          name: 'Phone',
          publicKey: phone.publicKey,
          privateKey: phone.privateKey!,
          keepalive: '',
          allowedIps: '10.8.0.2/32',
        },
        phone,
      ),
    ).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'network',
          section: 'cfg_phone',
          values: { description: 'Phone', public_key: KEY('p'), private_key: KEY('q'), allowed_ips: ['10.8.0.2/32'] },
        },
      },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'cfg_phone', option: 'preshared_key' } },
      {
        object: 'uci',
        method: 'delete',
        params: { config: 'network', section: 'cfg_phone', option: 'persistent_keepalive' },
      },
    ]);
  });
});

describe('clientConfig', () => {
  const [wg0] = parseWgConfig(network, firewall);
  it('writes a wg-quick file for a peer whose key the router keeps', () => {
    expect(
      clientConfig(wg0, wg0.peers[0], {
        serverPublicKey: KEY('S'),
        endpoint: 'home.example.com',
        dns: ['192.168.8.1'],
        allowedIps: ['0.0.0.0/0', '::/0'],
      }),
    ).toBe(
      [
        '[Interface]',
        `PrivateKey = ${KEY('q')}`,
        'Address = 10.8.0.2/32',
        'DNS = 192.168.8.1',
        '',
        '[Peer]',
        `PublicKey = ${KEY('S')}`,
        `PresharedKey = ${KEY('k')}`,
        'Endpoint = home.example.com:51820',
        'AllowedIPs = 0.0.0.0/0, ::/0',
        'PersistentKeepalive = 25',
        '',
      ].join('\n'),
    );
  });

  it('brackets an IPv6 endpoint and refuses a peer without a stored key', () => {
    const text = clientConfig(wg0, wg0.peers[0], {
      serverPublicKey: KEY('S'),
      endpoint: '2001:db8::1',
      allowedIps: ['192.168.8.0/24'],
    });
    expect(text).toContain('Endpoint = [2001:db8::1]:51820');
    expect(text).not.toContain('DNS');
    expect(() => clientConfig(wg0, wg0.peers[1], { serverPublicKey: KEY('S'), endpoint: 'x', allowedIps: [] })).toThrow(
      expect.objectContaining({ code: 'no-private-key' }),
    );
  });
});

describe('router calls', () => {
  it('generates a key pair on the router', async () => {
    const conn = new FixtureConnection().override(
      'luci.wireguard.generateKeyPair',
      ok({ keys: { priv: KEY('a'), pub: KEY('b') } }),
    );
    expect(await generateKeyPair(conn)).toEqual({ privateKey: KEY('a'), publicKey: KEY('b') });
  });

  it('reads config, firewall and live status together', async () => {
    const conn = new FixtureConnection('openwrt-24.10.8');
    const state = await getWgConfig(conn);
    expect(state.interfaces.map((i) => i.name)).toEqual(['wg0']);
    expect(state.publicKeys.wg0).toMatch(/=$/);
  });
});
