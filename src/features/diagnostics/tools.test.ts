import { isValidTarget, parseNslookup, parsePing, parseTraceroute, toolCommand } from './tools';

describe('toolCommand', () => {
  it('builds the LuCI-allowed commands', () => {
    expect(toolCommand('ping', '1.1.1.1', { count: 10 })).toEqual({
      command: '/bin/ping',
      params: ['-c', '10', '-W', '2', '-w', '23', '1.1.1.1'],
    });
    expect(toolCommand('ping', '2606:4700::1111').command).toBe('/bin/ping6');
    expect(toolCommand('traceroute', 'example.com', { ipv6: true })).toEqual({
      command: '/bin/traceroute6',
      params: ['-n', '-w', '1', '-q', '1', '-m', '20', 'example.com'],
    });
    expect(toolCommand('nslookup', 'example.com', { server: '223.5.5.5' }).params).toEqual([
      'example.com',
      '223.5.5.5',
    ]);
  });

  it('accepts host names and addresses only', () => {
    expect(['openwrt.org', '192.168.1.1', 'fe80::1%br-lan', 'router.lan.', 'x']).toEqual(
      ['openwrt.org', '192.168.1.1', 'fe80::1%br-lan', 'router.lan.', 'x'].filter(isValidTarget),
    );
    expect(['', '-c 5', 'a b', 'foo;reboot', '1.2.3.4/24', 'a'.repeat(300)].filter(isValidTarget)).toEqual([]);
  });
});

describe('parsePing', () => {
  it('reads busybox replies and statistics', () => {
    const out = `PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: seq=0 ttl=57 time=12.345 ms
64 bytes from 1.1.1.1: seq=1 ttl=57 time=10.000 ms
64 bytes from 1.1.1.1: seq=3 ttl=57 time=14.000 ms

--- 1.1.1.1 ping statistics ---
4 packets transmitted, 3 packets received, 25% packet loss
round-trip min/avg/max = 10.000/12.115/14.000 ms
`;
    const p = parsePing(out);
    expect(p).toMatchObject({ transmitted: 4, received: 3, lossPct: 25, min: 10, avg: 12.115, max: 14 });
    expect(p.replies.map((r) => r.seq)).toEqual([0, 1, 3]);
    expect(p.jitter).toBeCloseTo((2.345 + 4) / 2);
    expect(p.error).toBeUndefined();
  });

  it('handles total loss and errors', () => {
    expect(
      parsePing(`PING 10.9.9.9 (10.9.9.9): 56 data bytes

--- 10.9.9.9 ping statistics ---
3 packets transmitted, 0 packets received, 100% packet loss
`),
    ).toMatchObject({ transmitted: 3, received: 0, lossPct: 100, avg: undefined });
    expect(parsePing('ping: sendto: Network unreachable\n')).toMatchObject({
      lossPct: 100,
      error: 'sendto: Network unreachable',
    });
    expect(parsePing("ping: bad address 'nope.invalid'\n").error).toBe("bad address 'nope.invalid'");
  });
});

it('parses traceroute hops, with names, without, and silent ones', () => {
  const out = `traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 46 byte packets
 1  192.168.8.1  0.512 ms
 2  *
 3  OpenWrt.lan (192.168.1.1)  1.234 ms
10  one.one.one.one (1.1.1.1)  9.876 ms
`;
  expect(parseTraceroute(out)).toEqual([
    { hop: 1, ip: '192.168.8.1', host: undefined, times: [0.512] },
    { hop: 2, ip: undefined, host: undefined, times: [] },
    { hop: 3, ip: '192.168.1.1', host: 'OpenWrt.lan', times: [1.234] },
    { hop: 10, ip: '1.1.1.1', host: 'one.one.one.one', times: [9.876] },
  ]);
});

describe('parseNslookup', () => {
  it('reads busybox answers, IPv4 and IPv6, and CNAMEs', () => {
    const out = `Server:		127.0.0.1
Address:	127.0.0.1:53

Non-authoritative answer:
www.baidu.com	canonical name = www.a.shifen.com
Name:	www.a.shifen.com
Address: 110.242.68.66

Non-authoritative answer:
Name:	example.com
Address: 2606:2800:21f:cb07:6820:80da:af6b:8b2c
`;
    expect(parseNslookup(out)).toEqual({
      server: '127.0.0.1',
      answers: [
        { name: 'www.baidu.com', cname: 'www.a.shifen.com' },
        { name: 'www.a.shifen.com', address: '110.242.68.66' },
        { name: 'example.com', address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c' },
      ],
      error: undefined,
    });
  });

  it('reports NXDOMAIN and timeouts', () => {
    expect(
      parseNslookup(`Server:		127.0.0.1
Address:	127.0.0.1:53

** server can't find nope.invalid: NXDOMAIN
`).error,
    ).toBe('NXDOMAIN');
    expect(parseNslookup(';; connection timed out; no servers could be reached\n').error).toBe('TIMEOUT');
  });
});
