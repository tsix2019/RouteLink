import { fail, FixtureConnection, ok } from '../../../test/fixture-connection';
import {
  blockChanges,
  isDnsSafeName,
  kickClient,
  removeStaticIpChanges,
  renameChanges,
  staticIpChanges,
  unblockChanges,
  wakeOnLan,
} from './client-actions';
import { ALIAS_OPTION, BLOCK_RULE_PREFIX, type Client } from './clients';

const client = (over: Partial<Client> = {}): Client => ({
  mac: 'AA:BB:CC:00:11:22',
  name: 'tv',
  vendor: null,
  randomizedMac: false,
  ipv6: [],
  online: true,
  onlineSource: 'neighbor',
  connection: 'wired',
  isStatic: false,
  isBlocked: false,
  ...over,
});

describe('isDnsSafeName', () => {
  it.each([
    ['living-room-tv', true],
    ['TV2', true],
    ['客厅电视', false],
    ['my tv', false],
    ['-tv', false],
    ['a'.repeat(64), false],
  ])('%s → %s', (name, safe) => {
    expect(isDnsSafeName(name)).toBe(safe);
  });
});

describe('renameChanges', () => {
  it('adds a host with a DNS name for new devices', () => {
    expect(renameChanges(client(), 'living-room-tv')).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: { config: 'dhcp', type: 'host', values: { mac: 'AA:BB:CC:00:11:22', name: 'living-room-tv' } },
      },
    ]);
  });

  it('stores non-DNS names in the alias option, never in `name`', () => {
    const [call] = renameChanges(client({ hostSection: 'cfg1', alias: 'tv', aliasSource: 'name' }), '客厅电视');
    expect(call.params).toEqual({ config: 'dhcp', section: 'cfg1', values: { [ALIAS_OPTION]: '客厅电视' } });
  });

  it('drops the custom alias when switching back to a DNS-safe name', () => {
    const calls = renameChanges(client({ hostSection: 'cfg1', alias: '客厅电视', aliasSource: 'custom' }), 'tv');
    expect(calls.map((c) => c.method)).toEqual(['set', 'delete']);
    expect(calls[1].params).toEqual({ config: 'dhcp', section: 'cfg1', option: ALIAS_OPTION });
  });

  it('rejects empty and overlong names', () => {
    expect(() => renameChanges(client(), '  ')).toThrow('name-empty');
    expect(() => renameChanges(client(), 'x'.repeat(65))).toThrow('name-too-long');
  });
});

describe('staticIpChanges', () => {
  it('creates a host with IP and the DNS-safe hostname', () => {
    const [call] = staticIpChanges(client({ hostname: 'nas' }), '192.168.1.50', []);
    expect(call.params).toEqual({
      config: 'dhcp',
      type: 'host',
      values: { mac: 'AA:BB:CC:00:11:22', ip: '192.168.1.50', name: 'nas' },
    });
  });

  it('updates an existing host section', () => {
    const [call] = staticIpChanges(client({ hostSection: 'cfg9' }), '192.168.1.51', []);
    expect(call).toEqual({
      object: 'uci',
      method: 'set',
      params: { config: 'dhcp', section: 'cfg9', values: { ip: '192.168.1.51' } },
    });
  });

  it('rejects invalid and duplicate addresses', () => {
    expect(() => staticIpChanges(client(), '192.168.1.300', [])).toThrow('ip-invalid');
    const other = client({ mac: 'AA:BB:CC:00:11:99', staticIp: '192.168.1.50' });
    expect(() => staticIpChanges(client(), '192.168.1.50', [other])).toThrow('ip-in-use');
  });
});

describe('removeStaticIpChanges', () => {
  it('removes only the IP when a name remains', () => {
    const [call] = removeStaticIpChanges(client({ hostSection: 'c', staticIp: '1.2.3.4', alias: 'tv' }));
    expect(call).toEqual({ object: 'uci', method: 'delete', params: { config: 'dhcp', section: 'c', option: 'ip' } });
  });

  it('removes the whole section otherwise', () => {
    const [call] = removeStaticIpChanges(client({ hostSection: 'c', staticIp: '1.2.3.4' }));
    expect(call).toEqual({ object: 'uci', method: 'delete', params: { config: 'dhcp', section: 'c' } });
  });
});

describe('block / unblock', () => {
  it('adds a zone-independent REJECT rule named after the MAC', () => {
    const [call] = blockChanges(client());
    expect(call.params).toEqual({
      config: 'firewall',
      type: 'rule',
      values: {
        name: `${BLOCK_RULE_PREFIX}AA:BB:CC:00:11:22`,
        src: '*',
        dest: '*',
        src_mac: ['AA:BB:CC:00:11:22'],
        proto: 'all',
        target: 'REJECT',
      },
    });
  });

  it('deletes the rule section to unblock', () => {
    expect(unblockChanges(client({ isBlocked: true, blockSection: 'cfgX' }))[0].params).toEqual({
      config: 'firewall',
      section: 'cfgX',
    });
    expect(() => unblockChanges(client())).toThrow('not-blocked');
  });
});

describe('kickClient', () => {
  it('deauthenticates through the hostapd object of its interface', async () => {
    const conn = new FixtureConnection().override('hostapd.phy0-ap0.del_client', ok({}));
    const wifi = { ifname: 'phy0-ap0', ssid: 's', band: '2.4G' as const, signal: -50 };
    await kickClient(conn, client({ wifi, connection: 'wifi' }), 5);
    expect(conn.calls[0]).toEqual({
      object: 'hostapd.phy0-ap0',
      method: 'del_client',
      params: { addr: 'aa:bb:cc:00:11:22', reason: 5, deauth: true, ban_time: 300_000 },
    });
  });

  it('refuses wired clients', async () => {
    await expect(kickClient(new FixtureConnection(), client())).rejects.toThrow('not-wireless');
  });
});

describe('wakeOnLan', () => {
  it('uses etherwake on the router when available', async () => {
    const conn = new FixtureConnection().override(
      'file.exec.usr-bin-etherwake-d-i-br-lan-aa-bb-cc-00-11-22',
      ok({ code: 0 }),
    );
    await expect(wakeOnLan(conn, 'AA:BB:CC:00:11:22', { routerSide: true })).resolves.toBe('router');
  });

  it("goes through LuCI's luci.wol object where file exec is not granted (25.12)", async () => {
    const conn = new FixtureConnection()
      .override('file.exec.usr-bin-etherwake-d-i-br-lan-aa-bb-cc-00-11-22', fail('PERMISSION_DENIED', 'file.exec'))
      .override('luci.wol.exec', ok({ code: 0, stdout: '', stderr: '' }));
    await expect(wakeOnLan(conn, 'AA:BB:CC:00:11:22', { routerSide: true })).resolves.toBe('router');
    expect(conn.calls.at(-1)).toEqual({
      object: 'luci.wol',
      method: 'exec',
      params: { name: '/usr/bin/etherwake', args: ['-D', '-i', 'br-lan', 'AA:BB:CC:00:11:22'] },
    });
  });

  it('reports etherwake failures', async () => {
    const conn = new FixtureConnection().override(
      'file.exec.usr-bin-etherwake-d-i-br-lan-aa-bb-cc-00-11-22',
      ok({ code: 1, stderr: 'no such device' }),
    );
    await expect(wakeOnLan(conn, 'AA:BB:CC:00:11:22', { routerSide: true })).rejects.toThrow('no such device');
  });

  it('falls back to the phone, else reports unavailable', async () => {
    const send = jest.fn(async () => undefined);
    await expect(
      wakeOnLan(new FixtureConnection(), 'AA:BB:CC:00:11:22', { routerSide: false, sendFromPhone: send }),
    ).resolves.toBe('phone');
    expect(send).toHaveBeenCalledWith('AA:BB:CC:00:11:22');
    await expect(wakeOnLan(new FixtureConnection(), 'AA:BB:CC:00:11:22', { routerSide: false })).rejects.toThrow(
      'wol-unavailable',
    );
  });
});
