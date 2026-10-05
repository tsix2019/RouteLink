// Routes (NW-4) and firewall (NW-6) against a real router: kernel tables through LuCI's `ip route`
// grant, static routes, port forwards and rules through uci with the rollback timer.
import {
  applyFirewallChanges,
  deleteSectionChanges,
  getFirewall,
  portForwardChanges,
  setEnabledChanges,
  trafficRuleChanges,
  validatePortForward,
  validateTrafficRule,
} from '../../src/api/services/firewall';
import { getInterfaces } from '../../src/api/services/network';
import { deleteStaticRoute, getRoutes, saveStaticRoute, validateStaticRoute } from '../../src/api/services/routes';
import { intToIp, parseCidr } from '../../src/utils/net';
import { connect } from './router';

const fast = { timeoutSec: 30 };

describe('routes', () => {
  const { conn } = connect();

  it('reads the main table with the default route and the LAN subnet', async () => {
    const { kernel } = await getRoutes(conn);
    const main = kernel.filter((r) => r.family === 4 && r.table === 'main');
    expect(main.some((r) => r.target === 'default' && r.via)).toBe(true);
    expect(main.some((r) => r.scope === 'link' && r.target.includes('/'))).toBe(true);
    expect(kernel.some((r) => r.table === 'local' && r.type === 'local')).toBe(true);
  });

  it('adds, finds and deletes a static route', async () => {
    const lan = (await getInterfaces(conn)).find((i) => i.name === 'lan')!;
    const { network, prefix } = parseCidr(`${lan.ipv4[0].address}/${lan.ipv4[0].mask}`);
    let gateway = intToIp(network + 9);
    if (gateway === lan.ipv4[0].address) gateway = intToIp(network + 10);
    expect(prefix).toBeLessThan(30);

    const input = { family: 4 as const, interface: 'lan', target: '10.123.0.0/16', gateway, metric: '7', table: '' };
    expect(validateStaticRoute(input, lan)).toEqual({});
    expect((await saveStaticRoute(conn, input, undefined, fast)).status).toBe('confirmed');

    const after = await getRoutes(conn);
    const saved = after.statics.find((s) => s.target === '10.123.0.0/16');
    expect(saved).toMatchObject({ family: 4, interface: 'lan', gateway, metric: '7' });
    expect(after.kernel.find((r) => r.target === '10.123.0.0/16')).toMatchObject({ via: gateway, metric: 7 });

    expect((await deleteStaticRoute(conn, saved!, fast)).status).toBe('confirmed');
    const gone = await getRoutes(conn);
    expect(gone.statics.some((s) => s.target === '10.123.0.0/16')).toBe(false);
    expect(gone.kernel.some((r) => r.target === '10.123.0.0/16')).toBe(false);
  }, 120_000);
});

describe('firewall', () => {
  const { conn } = connect();

  it('reads zones with the masquerading WAN zone', async () => {
    const fw = await getFirewall(conn);
    expect(fw.zones.find((z) => z.name === 'wan')).toMatchObject({ masq: true });
    expect(fw.forwardings.some((f) => f.src === 'lan' && f.dest === 'wan')).toBe(true);
  });

  beforeAll(async () => {
    const fw = await getFirewall(conn);
    const leftovers = [...fw.forwards, ...fw.rules].filter((x) => x.name.startsWith('RouteLink-Test'));
    if (leftovers.length)
      await applyFirewallChanges(
        conn,
        leftovers.flatMap((x) => deleteSectionChanges(x.section)),
        fast,
      );
  });

  it('adds, edits, switches off and deletes a port forward', async () => {
    const lan = (await getInterfaces(conn)).find((i) => i.name === 'lan')!;
    const { network } = parseCidr(`${lan.ipv4[0].address}/${lan.ipv4[0].mask}`);
    const input = {
      name: 'RouteLink-Test',
      protocols: ['tcp', 'udp'] as ('tcp' | 'udp')[],
      srcZone: 'wan',
      externalPort: '18554',
      destZone: 'lan',
      internalIp: intToIp(network + 77),
      internalPort: '554',
    };
    expect(validatePortForward(input)).toEqual({});
    expect((await applyFirewallChanges(conn, portForwardChanges(input), fast)).status).toBe('confirmed');
    let f = (await getFirewall(conn)).forwards.find((x) => x.name === 'RouteLink-Test')!;
    expect(f).toMatchObject({ protocols: ['tcp', 'udp'], externalPort: '18554', internalPort: '554', enabled: true });

    await applyFirewallChanges(conn, portForwardChanges({ ...input, protocols: ['tcp'], internalPort: '' }, f), fast);
    f = (await getFirewall(conn)).forwards.find((x) => x.section === f.section)!;
    expect(f.protocols).toEqual(['tcp']);
    expect(f.internalPort).toBeUndefined();

    await applyFirewallChanges(conn, setEnabledChanges(f.section, false), fast);
    expect((await getFirewall(conn)).forwards.find((x) => x.section === f.section)?.enabled).toBe(false);

    await applyFirewallChanges(conn, deleteSectionChanges(f.section), fast);
    expect((await getFirewall(conn)).forwards.some((x) => x.section === f.section)).toBe(false);
  }, 180_000);

  it('adds and deletes a traffic rule', async () => {
    const input = {
      name: 'RouteLink-Test-Rule',
      src: 'lan',
      dest: 'wan',
      protocols: ['tcp'],
      srcIp: '',
      destIp: '192.0.2.1 198.51.100.0/24',
      destPort: '23 2323',
      target: 'REJECT' as const,
      family: 'ipv4' as const,
    };
    expect(validateTrafficRule(input)).toEqual({});
    await applyFirewallChanges(conn, trafficRuleChanges(input), fast);
    const r = (await getFirewall(conn)).rules.find((x) => x.name === 'RouteLink-Test-Rule')!;
    expect(r).toMatchObject({ destIp: ['192.0.2.1', '198.51.100.0/24'], destPort: '23 2323', target: 'REJECT' });
    await applyFirewallChanges(conn, deleteSectionChanges(r.section), fast);
    expect((await getFirewall(conn)).rules.some((x) => x.name === 'RouteLink-Test-Rule')).toBe(false);
  }, 120_000);
});
