// Routes (NW-4) against a real router: kernel tables through LuCI's `ip route` grant, static
// routes through uci with the rollback timer.
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
