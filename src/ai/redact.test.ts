import {
  DEFAULT_PRIVACY,
  ipOut,
  isPrivateIp,
  macOut,
  maskIp,
  maskMac,
  nameOut,
  scrubText,
  stripSecrets,
  type Privacy,
} from './redact';

const off = (patch: Partial<Privacy>): Privacy => ({ ...DEFAULT_PRIVACY, ...patch });

describe('masking', () => {
  it('keeps the manufacturer half of a MAC and the network half of a public address', () => {
    expect(maskMac('3c:22:fb:61:0e:8d')).toBe('3C:22:FB:**:**:**');
    expect(maskIp('203.0.113.45')).toBe('203.0.*.*');
    expect(maskIp('2001:db8:1234:5678::1')).toBe('2001:db8:1234::*');
    expect(maskIp('192.168.8.101')).toBe('192.168.8.101');
  });

  it('knows private, CGNAT, link-local and ULA addresses', () => {
    for (const ip of ['10.1.2.3', '172.20.0.1', '192.168.1.1', '100.64.0.9', '169.254.1.1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ['203.0.113.45', '8.8.8.8', '172.32.0.1', '2001:db8::1']) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('what goes out', () => {
  it('masks by default, sends in full when masking is off, nothing when a kind is off', () => {
    expect(macOut('3c:22:fb:61:0e:8d', DEFAULT_PRIVACY)).toBe('3C:22:FB:**:**:**');
    expect(macOut('3c:22:fb:61:0e:8d', off({ mask: false }))).toBe('3C:22:FB:61:0E:8D');
    expect(macOut('3c:22:fb:61:0e:8d', off({ macs: false }))).toBeUndefined();
    expect(ipOut('203.0.113.45', DEFAULT_PRIVACY)).toBe('203.0.*.*');
    expect(ipOut('192.168.8.5', DEFAULT_PRIVACY)).toBe('192.168.8.5');
    expect(ipOut('192.168.8.5', off({ ips: false }))).toBeUndefined();
    expect(nameOut('Alice-iPhone', off({ names: false }))).toBeUndefined();
  });

  it('scrubs log lines the same way', () => {
    const line = 'DHCPACK(br-lan) 192.168.8.105 f2:4c:1d:7e:3a:91 Galaxy-S25 via 203.0.113.45';
    expect(scrubText(line, DEFAULT_PRIVACY)).toBe(
      'DHCPACK(br-lan) 192.168.8.105 F2:4C:1D:**:**:** Galaxy-S25 via 203.0.*.*',
    );
    expect(scrubText(line, off({ ips: false, macs: false }))).toBe('DHCPACK(br-lan) [ip] [mac] Galaxy-S25 via [ip]');
    expect(scrubText('version 1.2.300.4', DEFAULT_PRIVACY)).toBe('version 1.2.300.4');
  });

  it('never sends a secret, at any depth', () => {
    expect(
      stripSecrets({
        ssid: 'Home',
        key: 'hunter22',
        networks: [{ ssid: 'Guest', password: 'x', psk: 'y', sae_password: 'z', private_key: 'k', hidden: false }],
        gone: undefined,
      }),
    ).toEqual({ ssid: 'Home', networks: [{ ssid: 'Guest', hidden: false }] });
  });
});
