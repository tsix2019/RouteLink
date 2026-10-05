import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import { getWireGuard, parseWgInstances, peerConnected } from './wireguard';

// What luci-proto-wireguard's `getWgInstances` returns: `wg show all dump`, values as strings.
const raw = {
  wg0: {
    name: 'wg0',
    public_key: 'Q1R1aGtVczl4bXhWT2h3a0x0Zm1qWmRKbm9XQzJ3dHQ=',
    listen_port: '51820',
    fwmark: 'off',
    peers: [
      {
        name: 'Phone',
        public_key: 'cGhvbmVwdWJsaWNrZXlwaG9uZXB1YmxpY2tleXBob24=',
        endpoint: '198.51.100.7:40211',
        allowed_ips: ['10.8.0.2/32', 'fd00:9::2/128'],
        latest_handshake: '1800000000',
        transfer_rx: '1048576',
        transfer_tx: '73400320',
        persistent_keepalive: '25',
      },
      {
        public_key: 'bGFwdG9wcHVibGlja2V5bGFwdG9wcHVibGlja2V5bGE=',
        endpoint: '(none)',
        allowed_ips: [],
        latest_handshake: '0',
        transfer_rx: '0',
        transfer_tx: '0',
        persistent_keepalive: 'off',
      },
    ],
  },
  wg1: { name: 'wg1', public_key: '(none)', listen_port: '0', fwmark: 'off', peers: [] },
};

describe('parseWgInstances', () => {
  it('reads interfaces and peers, with numbers and "never" turned into values', () => {
    expect(parseWgInstances(raw)).toEqual([
      {
        name: 'wg0',
        publicKey: 'Q1R1aGtVczl4bXhWT2h3a0x0Zm1qWmRKbm9XQzJ3dHQ=',
        listenPort: 51820,
        peers: [
          {
            name: 'Phone',
            publicKey: 'cGhvbmVwdWJsaWNrZXlwaG9uZXB1YmxpY2tleXBob24=',
            endpoint: '198.51.100.7:40211',
            allowedIps: ['10.8.0.2/32', 'fd00:9::2/128'],
            latestHandshake: 1_800_000_000,
            rx: 1_048_576,
            tx: 73_400_320,
            keepalive: 25,
          },
          {
            publicKey: 'bGFwdG9wcHVibGlja2V5bGFwdG9wcHVibGlja2V5bGE=',
            allowedIps: [],
            rx: 0,
            tx: 0,
          },
        ],
      },
      { name: 'wg1', publicKey: '', peers: [] },
    ]);
  });

  it('tolerates junk', () => {
    expect(parseWgInstances(null)).toEqual([]);
    expect(parseWgInstances({ wg0: null, wg1: { peers: 'x' } })).toEqual([{ name: 'wg1', publicKey: '', peers: [] }]);
  });
});

describe('peerConnected', () => {
  it('counts a handshake in the last three minutes', () => {
    const [phone, laptop] = parseWgInstances(raw)[0].peers;
    expect(peerConnected(phone, 1_800_000_100)).toBe(true);
    expect(peerConnected(phone, 1_800_000_200)).toBe(false);
    expect(peerConnected(laptop, 1_800_000_100)).toBe(false);
  });
});

describe('getWireGuard', () => {
  it('calls luci.wireguard getWgInstances', async () => {
    const conn = new FixtureConnection('none').override('luci.wireguard.getWgInstances', ok(raw));
    expect((await getWireGuard(conn)).map((i) => i.name)).toEqual(['wg0', 'wg1']);
  });

  it('is empty without the LuCI WireGuard package', async () => {
    const missing = new FixtureConnection('none').override('luci.wireguard.getWgInstances', fail('NOT_FOUND'));
    expect(await getWireGuard(missing)).toEqual([]);
    const denied = new FixtureConnection('none').override('luci.wireguard.getWgInstances', fail('PERMISSION_DENIED'));
    await expect(getWireGuard(denied)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
