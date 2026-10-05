import { FixtureConnection, fail, ok } from '../../../test/fixture-connection';
import { getConnections, groupBySource, parseConntrack, ReverseDns } from './conntrack';

const raw = {
  result: [
    {
      bytes: 52_000,
      packets: 61,
      layer3: 'ipv4',
      layer4: 'tcp',
      src: '192.168.8.101',
      sport: 51_234,
      dst: '142.250.66.110',
      dport: 443,
      timeout: 431_990,
    },
    {
      bytes: 1_200_000,
      packets: 900,
      layer3: 'ipv4',
      layer4: 'udp',
      src: '192.168.8.106',
      sport: 40_000,
      dst: '203.0.113.9',
      dport: 443,
      timeout: 170,
    },
    { bytes: 300, packets: 4, layer3: 'ipv4', layer4: 'icmp', src: '192.168.8.101', dst: '223.5.5.5', timeout: 20 },
    {
      bytes: 9_000,
      packets: 20,
      layer3: 'ipv6',
      layer4: 'tcp',
      src: 'fd00:8::101',
      sport: 50_000,
      dst: '2404:6800:4005::200e',
      dport: 443,
      timeout: 7_400,
    },
    // The router talking to itself: not shown.
    { bytes: 100, packets: 2, layer3: 'ipv4', layer4: 'tcp', src: '127.0.0.1', sport: 1, dst: '127.0.0.1', dport: 2 },
    { layer3: 'ipv4', layer4: 'udp', src: '192.168.8.103', sport: 5353, dst: '224.0.0.251', dport: 5353 },
  ],
};

describe('parseConntrack', () => {
  it('reads LuCI’s connection list, skipping loopback', () => {
    const list = parseConntrack(raw);
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({
      family: 4,
      protocol: 'tcp',
      src: '192.168.8.101',
      sport: 51_234,
      dst: '142.250.66.110',
      dport: 443,
      bytes: 52_000,
      packets: 61,
      timeout: 431_990,
    });
    expect(list[2]).toMatchObject({ protocol: 'icmp', sport: undefined, dport: undefined });
    expect(list[3]).toMatchObject({ family: 6, dst: '2404:6800:4005::200e' });
    // Without conntrack accounting there are no byte counts.
    expect(list[4]).toMatchObject({ bytes: 0, packets: 0 });
  });

  it('tolerates junk', () => {
    expect(parseConntrack(null)).toEqual([]);
    expect(parseConntrack({ result: [null, { layer3: 'ipv4' }] })).toEqual([]);
  });
});

describe('groupBySource', () => {
  it('groups by the address that opened the connection, busiest first', () => {
    const groups = groupBySource(parseConntrack(raw));
    expect(groups.map((g) => [g.address, g.bytes, g.connections.length])).toEqual([
      ['192.168.8.106', 1_200_000, 1],
      ['192.168.8.101', 52_300, 2],
      ['fd00:8::101', 9_000, 1],
      ['192.168.8.103', 0, 1],
    ]);
    expect(groups[1].connections.map((c) => c.protocol)).toEqual(['tcp', 'icmp']);
  });
});

describe('getConnections', () => {
  it('calls luci getConntrackList', async () => {
    const conn = new FixtureConnection('none').override('luci.getConntrackList', ok(raw));
    expect(await getConnections(conn)).toHaveLength(5);
  });
});

describe('ReverseDns', () => {
  it('asks only for unknown addresses, in batches, and caches the answers', async () => {
    let now = 0;
    const asked: string[][] = [];
    const conn = new FixtureConnection('none').override('network.rrdns.lookup', (call) => {
      const addrs = (call.params as { addrs: string[] }).addrs;
      asked.push(addrs);
      return ok(Object.fromEntries(addrs.filter((a) => a !== '10.0.0.9').map((a) => [a, `host-${a}`])));
    });
    const dns = new ReverseDns(() => now, 2);
    const addrs = ['1.1.1.1', '8.8.8.8', '10.0.0.9'];

    expect(await dns.resolve(conn, addrs)).toEqual({ '1.1.1.1': 'host-1.1.1.1', '8.8.8.8': 'host-8.8.8.8' });
    expect(asked).toEqual([['1.1.1.1', '8.8.8.8'], ['10.0.0.9']]);
    expect(conn.calls[0].params).toMatchObject({ timeout: 3_000 });

    // Cached, unanswered addresses included: nothing is asked again within ten minutes.
    now += 5 * 60_000;
    expect(await dns.resolve(conn, ['8.8.8.8', '10.0.0.9'])).toEqual({ '8.8.8.8': 'host-8.8.8.8' });
    expect(asked).toHaveLength(2);

    now += 6 * 60_000;
    await dns.resolve(conn, ['8.8.8.8']);
    expect(asked).toHaveLength(3);
  });

  it('gives up quietly when the router can’t resolve', async () => {
    const conn = new FixtureConnection('none').override('network.rrdns.lookup', fail('PERMISSION_DENIED'));
    expect(await new ReverseDns(() => 0).resolve(conn, ['1.1.1.1'])).toEqual({});
  });
});
