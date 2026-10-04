import { cidrHosts, intToIp, ipToInt, isIPv4, netmaskToPrefix, parseCidr, scanTargets } from './net';

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
