import {
  cidrHosts,
  intToIp,
  ipToInt,
  ipv6ToWords,
  isIPv4,
  isIPv6,
  netmaskToPrefix,
  parseCidr,
  parsePrefix,
  prefixContains,
  scanTargets,
  wordsToIpv6,
  isPrivateIPv4,
} from './net';

describe('ipToInt / intToIp', () => {
  it('round-trips addresses', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '192.168.1.254', '255.255.255.255']) {
      expect(intToIp(ipToInt(ip))).toBe(ip);
    }
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['1.2.3', '1.2.3.256', 'a.b.c.d', '1.2.3.4.5', '']) {
      expect(() => ipToInt(bad)).toThrow();
      expect(isIPv4(bad)).toBe(false);
    }
  });
});

describe('netmaskToPrefix', () => {
  it.each([
    ['255.255.255.0', 24],
    ['255.255.0.0', 16],
    ['255.255.255.255', 32],
    ['255.255.252.0', 22],
    ['0.0.0.0', 0],
  ])('%s → /%d', (mask, prefix) => {
    expect(netmaskToPrefix(mask)).toBe(prefix);
  });

  it('rejects non-contiguous masks', () => {
    expect(() => netmaskToPrefix('255.0.255.0')).toThrow();
  });
});

describe('parseCidr / cidrHosts', () => {
  it('normalises the network address', () => {
    expect(parseCidr('192.168.1.77/24')).toEqual({ network: ipToInt('192.168.1.0'), prefix: 24 });
  });

  it('lists usable hosts of a /24', () => {
    const hosts = cidrHosts('192.168.1.0/24');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
  });

  it('handles /31 and /32', () => {
    expect(cidrHosts('10.0.0.8/31')).toEqual(['10.0.0.8', '10.0.0.9']);
    expect(cidrHosts('10.0.0.8/32')).toEqual(['10.0.0.8']);
  });

  it('allows up to /22 and refuses larger ranges', () => {
    expect(cidrHosts('10.0.0.0/22')).toHaveLength(1022);
    expect(() => cidrHosts('10.0.0.0/16')).toThrow(/too large/);
  });

  it('rejects malformed CIDR', () => {
    expect(() => parseCidr('10.0.0.0')).toThrow();
    expect(() => parseCidr('10.0.0.0/33')).toThrow();
  });
});

describe('scanTargets', () => {
  it('scans the whole /24, gateway first, skipping the phone itself', () => {
    const t = scanTargets({ ip: '192.168.1.23', netmask: '255.255.255.0', gateway: '192.168.1.1' });
    expect(t[0]).toBe('192.168.1.1');
    expect(t).not.toContain('192.168.1.23');
    expect(t).toHaveLength(253);
    expect(new Set(t).size).toBe(t.length);
  });

  it('limits large subnets to the /24s of the phone and the gateway', () => {
    const t = scanTargets({ ip: '10.1.2.3', netmask: '255.255.0.0', gateway: '10.1.0.1' });
    expect(t[0]).toBe('10.1.0.1');
    expect(t).toContain('10.1.2.200');
    expect(t).toContain('10.1.0.200');
    expect(t).not.toContain('10.1.5.1');
    expect(t).toHaveLength(254 + 253);
  });

  it('works without a gateway', () => {
    const t = scanTargets({ ip: '192.168.8.5', netmask: '255.255.255.0', gateway: null });
    expect(t).toHaveLength(253);
    expect(t[0]).toBe('192.168.8.1');
  });
});

describe('IPv6 addresses', () => {
  it('expands "::" and dotted IPv4 tails', () => {
    expect(ipv6ToWords('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipv6ToWords('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6ToWords('FE80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6ToWords('2001:db8::ff00:42:8329')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329]);
    expect(ipv6ToWords('::ffff:192.0.2.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0201]);
    expect(ipv6ToWords('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects malformed addresses', () => {
    for (const bad of [
      '',
      ':1',
      '1:::2',
      '1::2::3',
      '12345::',
      'g::1',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4::5:6:7:8',
      '::1%eth0',
      '1.2.3.4::',
      '192.168.1.1',
    ]) {
      expect(isIPv6(bad)).toBe(false);
    }
    expect(isIPv6('fd00::1')).toBe(true);
  });

  it('prints the RFC 5952 form', () => {
    expect(wordsToIpv6([0, 0, 0, 0, 0, 0, 0, 0])).toBe('::');
    expect(wordsToIpv6([0x2001, 0xdb8, 0, 1, 1, 1, 1, 1])).toBe('2001:db8:0:1:1:1:1:1');
    expect(wordsToIpv6([0x2001, 0xdb8, 0, 0, 1, 0, 0, 1])).toBe('2001:db8::1:0:0:1');
    expect(wordsToIpv6([0x2001, 0, 0, 1, 0, 0, 0, 1])).toBe('2001:0:0:1::1');
    expect(wordsToIpv6([0xfe80, 0, 0, 0, 0, 0, 0, 0])).toBe('fe80::');
  });
});

describe('parsePrefix / prefixContains', () => {
  it('reads both families, with the network address', () => {
    expect(parsePrefix('192.168.1.5/24')).toEqual({
      family: 4,
      address: '192.168.1.5',
      prefix: 24,
      network: '192.168.1.0',
    });
    expect(parsePrefix('10.0.0.1')).toEqual({ family: 4, address: '10.0.0.1', prefix: 32, network: '10.0.0.1' });
    expect(parsePrefix('0.0.0.0/0')).toMatchObject({ prefix: 0, network: '0.0.0.0' });
    expect(parsePrefix('2001:DB8:0:0:1::5/64')).toEqual({
      family: 6,
      address: '2001:db8::1:0:0:5',
      prefix: 64,
      network: '2001:db8::',
    });
    expect(parsePrefix('fd00:8::1')).toMatchObject({ family: 6, prefix: 128 });
    expect(parsePrefix('::/0')).toMatchObject({ family: 6, prefix: 0, network: '::' });
  });

  it('rejects malformed prefixes', () => {
    for (const bad of ['', 'abc', '1.2.3.4/33', '::/129', '1.2.3.4/x', '1.2.3.4/', '1.2.3.4/24/1', '1.2.3/24']) {
      expect(parsePrefix(bad)).toBeNull();
    }
  });

  it('tests membership within one family', () => {
    expect(prefixContains('192.168.1.0/24', '192.168.1.77')).toBe(true);
    expect(prefixContains('192.168.1.0/24', '192.168.2.1')).toBe(false);
    expect(prefixContains('203.0.113.45/32', '203.0.113.45')).toBe(true);
    expect(prefixContains('fd00:8::/64', 'fd00:8::1234')).toBe(true);
    expect(prefixContains('fd00:8::/64', 'fd00:9::1')).toBe(false);
    expect(prefixContains('0.0.0.0/0', 'fd00::1')).toBe(false);
  });
});

describe('isPrivateIPv4', () => {
  it.each([
    ['10.0.2.15', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.8.1', true],
    ['100.64.0.1', true],
    ['100.128.0.1', false],
    ['169.254.1.1', true],
    ['203.0.113.45', false],
    ['not an ip', false],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });
});
