import { FixtureConnection, ok } from '../../test/fixture-connection';
import { detectCapabilities, isAvailable } from './capabilities';

describe('detectCapabilities (OpenWrt 24.10, no Wi-Fi, no etherwake)', () => {
  it('reports what the stock router supports', async () => {
    const caps = await detectCapabilities(new FixtureConnection());
    expect(caps['clients.leases']).toEqual({ status: 'ok' });
    expect(caps['clients.neighbors']).toEqual({ status: 'ok' });
    expect(caps.services).toEqual({ status: 'ok' });
    expect(caps['logs.system']).toEqual({ status: 'ok' });
    expect(caps['logs.kernel']).toEqual({ status: 'ok' });
    expect(caps['interfaces.control']).toEqual({ status: 'ok' });
    expect(caps['clients.wol.router']).toEqual({ status: 'missing-package', packages: ['etherwake', 'luci-app-wol'] });
    expect(caps['system.temperature']).toEqual({ status: 'unsupported' });
    expect(caps.wireless).toEqual({ status: 'unsupported' });
    expect(caps['wireless.scan']).toEqual({ status: 'unsupported' });
  });

  it('runs every check in a single batch', async () => {
    const conn = new FixtureConnection();
    const batch = jest.spyOn(conn, 'batch');
    await detectCapabilities(conn);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('enables Wi-Fi and router-side WOL when available', async () => {
    const conn = new FixtureConnection()
      .override('luci-rpc.getWirelessDevices', ok({ radio0: { up: true } }))
      .override('file.stat.usr-bin-etherwake', ok({ type: 'file' }))
      .override('session.access.file-usr-bin-etherwake-exec', ok({ access: true }));
    const caps = await detectCapabilities(conn);
    expect(isAvailable(caps, 'wireless')).toBe(true);
    expect(isAvailable(caps, 'wireless.scan')).toBe(true);
    expect(isAvailable(caps, 'clients.wol.router')).toBe(true);
  });

  it('flags a denied ACL as a missing package', async () => {
    const conn = new FixtureConnection().override('session.access.ubus-rc-init', ok({ access: false }));
    const caps = await detectCapabilities(conn);
    expect(caps.services).toEqual({ status: 'missing-package', packages: ['rpcd'] });
  });
});

describe.each(['openwrt-23.05.6', 'openwrt-24.10.8', 'openwrt-25.12.5'])('M3 pages on %s (QEMU recordings)', (set) => {
  it('grants what LuCI’s apps use, with the M3 packages installed', async () => {
    const caps = await detectCapabilities(
      new FixtureConnection(set).override('session.access.uci-network-write', ok({ access: true })),
    );
    for (const feature of [
      'network.wireguard.config',
      'network.openvpn',
      'network.ddns',
      'network.sqm',
      'network.adblock',
      'system.backup',
      'system.firmware',
      'system.reset',
    ] as const) {
      expect([feature, caps[feature]]).toEqual([feature, { status: 'ok' }]);
    }
  });

  it('falls back to adblock when adblock-fast is missing', async () => {
    const conn = new FixtureConnection(set)
      .override('session.access.ubus-luci-adblock-fast-getinitstatus', ok({ access: false }))
      .override('session.access.ubus-luci-adblock-fast-setinitaction', ok({ access: false }));
    expect((await detectCapabilities(conn))['network.adblock']).toEqual({ status: 'ok' });
  });

  it('names the packages for DDNS when they are missing', async () => {
    const conn = new FixtureConnection(set).override(
      'session.access.ubus-luci-ddns-get-services-status',
      ok({ access: false }),
    );
    expect((await detectCapabilities(conn))['network.ddns']).toEqual({
      status: 'missing-package',
      packages: ['ddns-scripts', 'luci-app-ddns'],
    });
  });
});

describe.each(['openwrt-23.05.6', 'openwrt-24.10.8', 'openwrt-25.12.5'])('M2 pages on %s (QEMU recordings)', (set) => {
  it('grants what LuCI’s own pages use', async () => {
    const conn = new FixtureConnection(set)
      // Recorded from the next run on; LuCI's firewall page has this grant on every release.
      .override('session.access.uci-firewall-write', ok({ access: true }));
    const caps = await detectCapabilities(conn);
    for (const feature of [
      'network.routes',
      'network.connections',
      'network.firewall',
      'network.wireguard',
      'system.processes',
      'system.cron',
      'system.leds',
      'system.password',
    ] as const) {
      expect([feature, caps[feature]]).toEqual([feature, { status: 'ok' }]);
    }
  });

  it('names the package when LuCI’s WireGuard support is missing', async () => {
    const conn = new FixtureConnection(set).override(
      'session.access.ubus-luci-wireguard-getwginstances',
      ok({ access: false }),
    );
    expect((await detectCapabilities(conn))['network.wireguard']).toEqual({
      status: 'missing-package',
      packages: ['luci-proto-wireguard'],
    });
  });
});
