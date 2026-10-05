// M2 services against what the QEMU routers (23.05, 24.10, 25.12) answered.
import { FixtureConnection } from '../../../test/fixture-connection';
import { getConnections } from './conntrack';
import { readCrontab } from './cron';
import { getFirewall } from './firewall';
import { getLanWan } from './interfaces-config';
import { getLeds } from './leds';
import { listProcesses } from './processes';
import { getRoutes } from './routes';
import { getWireGuard } from './wireguard';

describe.each(['openwrt-23.05.6', 'openwrt-24.10.8', 'openwrt-25.12.5'])('%s', (set) => {
  const conn = () => new FixtureConnection(set);

  it('routes: default route, LAN and WireGuard subnets, IPv6', async () => {
    const { kernel } = await getRoutes(conn());
    expect(kernel.find((r) => r.family === 4 && r.target === 'default')).toMatchObject({
      via: '10.0.2.2',
      dev: 'eth1',
    });
    expect(kernel.find((r) => r.target === '192.168.1.0/24')).toMatchObject({ dev: 'br-lan', scope: 'link' });
    expect(kernel.find((r) => r.target === '10.9.0.0/24')).toMatchObject({ dev: 'wg0' });
    expect(kernel.some((r) => r.family === 6 && r.type === 'unreachable')).toBe(true);
  });

  it('processes, connections and the scheduled task', async () => {
    const ps = await listProcesses(conn());
    expect(ps.length).toBeGreaterThan(10);
    expect(ps.some((p) => p.name === 'rpcd')).toBe(true);
    expect((await getConnections(conn())).length).toBeGreaterThan(0);
    const tab = await readCrontab(conn());
    expect(tab.lines).toEqual([
      { kind: 'entry', schedule: ['*/30', '*', '*', '*', '*'], command: 'logger routelink-test', managed: false },
    ]);
  });

  it('WireGuard with the test peer, no LEDs on x86', async () => {
    const [wg0] = await getWireGuard(conn());
    expect(wg0).toMatchObject({ name: 'wg0', listenPort: 51820 });
    expect(wg0.peers).toEqual([expect.objectContaining({ name: 'Test peer', rx: 0, tx: 0 })]);
    expect(await getLeds(conn())).toEqual([]);
  });

  it('firewall forward and LAN settings', async () => {
    const fw = await getFirewall(conn());
    expect(fw.forwards).toEqual([
      expect.objectContaining({ name: 'Test-HTTPS', externalPort: '8443', internalPort: '443' }),
    ]);
    const { lan, wan } = await getLanWan(conn());
    expect(lan).toMatchObject({
      ipaddr: '192.168.1.1',
      prefix: 24,
      style: set.includes('25.12') ? 'cidr-list' : 'netmask',
    });
    expect(wan).toMatchObject({ proto: 'dhcp', device: 'eth1' });
  });
});
