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
