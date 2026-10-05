import { FixtureConnection, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  deleteSectionChanges,
  forwardConflicts,
  getFirewall,
  parseFirewall,
  portForwardChanges,
  setEnabledChanges,
  trafficRuleChanges,
  validatePortForward,
  validateTrafficRule,
  type PortForward,
  type PortForwardInput,
  type TrafficRule,
  type TrafficRuleInput,
} from './firewall';

const recorded = () =>
  (loadFixture('openwrt-24.10.8', 'uci.get.firewall') as { ok: true; data: { values: Record<string, UciSection> } })
    .data.values;

const sections: Record<string, UciSection> = {
  ...recorded(),
  fwd_game: {
    '.name': 'fwd_game',
    '.type': 'redirect',
    '.index': 21,
    name: 'Game',
    src: 'wan',
    src_dport: '27000-27015',
    dest: 'lan',
    dest_ip: '192.168.1.120',
    proto: 'tcp udp',
    enabled: '0',
    reflection: '0',
  },
  // Source NAT is a redirect too, but not a port forward.
  snat: {
    '.name': 'snat',
    '.type': 'redirect',
    '.index': 22,
    src: 'lan',
    dest: 'wan',
    target: 'SNAT',
    snat_ip: '1.2.3.4',
  },
  block: {
    '.name': 'block',
    '.type': 'rule',
    '.index': 23,
    name: 'RouteLink: block AA:BB:CC:DD:EE:FF',
    src: '*',
    dest: '*',
    src_mac: ['AA:BB:CC:DD:EE:FF'],
    proto: 'all',
    target: 'REJECT',
  },
};

describe('parseFirewall', () => {
  const fw = parseFirewall(sections);

  it('reads the defaults, zones and zone forwardings', () => {
    expect(fw.defaults).toEqual({ input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' });
    expect(fw.zones).toEqual([
      {
        section: 'cfg02dc81',
        name: 'lan',
        networks: ['lan'],
        input: 'ACCEPT',
        output: 'ACCEPT',
        forward: 'ACCEPT',
        masq: false,
        mtuFix: false,
      },
      {
        section: 'cfg03dc81',
        name: 'wan',
        networks: ['wan', 'wan6'],
        input: 'REJECT',
        output: 'ACCEPT',
        forward: 'REJECT',
        masq: true,
        mtuFix: true,
      },
    ]);
    expect(fw.forwardings).toEqual([{ section: 'cfg04ad58', src: 'lan', dest: 'wan', enabled: true }]);
  });

  it('reads port forwards (the QEMU router has one), leaving out source NAT', () => {
    expect(fw.forwards).toEqual([
      {
        section: 'test_https',
        name: 'Test-HTTPS',
        protocols: ['tcp'],
        srcZone: 'wan',
        externalPort: '8443',
        destZone: 'lan',
        internalIp: '192.168.1.100',
        internalPort: '443',
        enabled: true,
        extra: [],
      },
      {
        section: 'fwd_game',
        name: 'Game',
        protocols: ['tcp', 'udp'],
        srcZone: 'wan',
        externalPort: '27000-27015',
        destZone: 'lan',
        internalIp: '192.168.1.120',
        enabled: false,
        extra: ['reflection'],
      },
    ]);
  });

  it('reads traffic rules; the app’s own block rules are marked', () => {
    expect(fw.rules).toHaveLength(10);
    expect(fw.rules[0]).toEqual({
      section: 'cfg0592bd',
      name: 'Allow-DHCP-Renew',
      src: 'wan',
      protocols: ['udp'],
      srcIp: [],
      destIp: [],
      destPort: '68',
      target: 'ACCEPT',
      family: 'ipv4',
      enabled: true,
      managed: false,
      extra: [],
    });
    expect(fw.rules[1]).toMatchObject({ name: 'Allow-Ping', protocols: ['icmp'], extra: ['icmp_type'] });
    expect(fw.rules[4]).toMatchObject({ name: 'Allow-MLD', srcIp: ['fe80::/10'], extra: ['icmp_type'] });
    expect(fw.rules[6]).toMatchObject({ name: 'Allow-ICMPv6-Forward', dest: '*' });
    expect(fw.rules[9]).toMatchObject({ managed: true, protocols: ['all'], extra: ['src_mac'] });
  });
});

describe('getFirewall', () => {
  it('reads uci firewall', async () => {
    const conn = new FixtureConnection('none').override('uci.get.firewall', ok({ values: sections }));
    expect((await getFirewall(conn)).forwards).toHaveLength(2);
  });
});

const forward = (patch: Partial<PortForwardInput> = {}): PortForwardInput => ({
  name: 'Camera',
  protocols: ['tcp'],
  srcZone: 'wan',
  externalPort: '8554',
  destZone: 'lan',
  internalIp: '192.168.1.130',
  internalPort: '554',
  ...patch,
});

describe('port forward validation', () => {
  it('accepts ports, ranges and an empty internal port', () => {
    expect(validatePortForward(forward())).toEqual({});
    expect(validatePortForward(forward({ externalPort: '5000-5010', internalPort: '' }))).toEqual({});
    expect(validatePortForward(forward({ externalPort: '5000-5010', internalPort: '6000-6010' }))).toEqual({});
    expect(validatePortForward(forward({ externalPort: '5000-5010', internalPort: '6000' }))).toEqual({});
  });

  it('checks every field', () => {
    expect(validatePortForward(forward({ name: 'a\nb' }))).toEqual({ name: 'name-invalid' });
    expect(validatePortForward(forward({ protocols: [] }))).toEqual({ protocols: 'protocols-empty' });
    for (const bad of ['', '0', '65536', '80-', '90-80', 'http', '80 443']) {
      expect(validatePortForward(forward({ externalPort: bad }))).toEqual({ externalPort: 'port-invalid' });
    }
    expect(validatePortForward(forward({ internalPort: '99999' }))).toEqual({ internalPort: 'port-invalid' });
    expect(validatePortForward(forward({ externalPort: '5000-5010', internalPort: '6000-6001' }))).toEqual({
      internalPort: 'range-mismatch',
    });
    expect(validatePortForward(forward({ internalIp: '192.168.1' }))).toEqual({ internalIp: 'ip-invalid' });
    expect(validatePortForward(forward({ srcZone: '', destZone: '' }))).toEqual({
      srcZone: 'zone-missing',
      destZone: 'zone-missing',
    });
  });

  it('finds enabled forwards that already use the external port', () => {
    const { forwards } = parseFirewall(sections);
    expect(forwardConflicts(forwards, forward({ externalPort: '8443' })).map((f) => f.name)).toEqual(['Test-HTTPS']);
    expect(forwardConflicts(forwards, forward({ externalPort: '8000-9000' })).map((f) => f.name)).toEqual([
      'Test-HTTPS',
    ]);
    // Same port, other protocol; the disabled Game forward; editing the forward itself.
    expect(forwardConflicts(forwards, forward({ externalPort: '8443', protocols: ['udp'] }))).toEqual([]);
    expect(forwardConflicts(forwards, forward({ externalPort: '27005' }))).toEqual([]);
    expect(forwardConflicts(forwards, forward({ externalPort: '8443' }), 'test_https')).toEqual([]);
  });
});

describe('port forward changes', () => {
  const nas = (): PortForward => parseFirewall(sections).forwards[0];

  it('adds a DNAT redirect', () => {
    expect(portForwardChanges(forward({ protocols: ['tcp', 'udp'] }))).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'firewall',
          type: 'redirect',
          values: {
            name: 'Camera',
            target: 'DNAT',
            src: 'wan',
            src_dport: '8554',
            dest: 'lan',
            dest_ip: '192.168.1.130',
            dest_port: '554',
            proto: 'tcp udp',
          },
        },
      },
    ]);
  });

  it('edits in place and drops a cleared internal port', () => {
    expect(portForwardChanges(forward({ name: 'NAS', internalPort: '' }), nas())).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'firewall',
          section: 'test_https',
          values: {
            name: 'NAS',
            target: 'DNAT',
            src: 'wan',
            src_dport: '8554',
            dest: 'lan',
            dest_ip: '192.168.1.130',
            proto: 'tcp',
          },
        },
      },
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'test_https', option: 'dest_port' } },
    ]);
  });

  it('switches on and off, and deletes', () => {
    expect(setEnabledChanges('fwd_game', true)).toEqual([
      { object: 'uci', method: 'set', params: { config: 'firewall', section: 'fwd_game', values: { enabled: '1' } } },
    ]);
    expect(setEnabledChanges('test_https', false)[0].params).toMatchObject({ values: { enabled: '0' } });
    expect(deleteSectionChanges('test_https')).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'test_https' } },
    ]);
  });
});

const rule = (patch: Partial<TrafficRuleInput> = {}): TrafficRuleInput => ({
  name: 'Block-Telnet',
  src: 'lan',
  dest: 'wan',
  protocols: ['tcp'],
  srcIp: '',
  destIp: '',
  destPort: '23',
  target: 'REJECT',
  family: '',
  ...patch,
});

describe('traffic rule validation', () => {
  it('accepts the usual shapes', () => {
    expect(validateTrafficRule(rule())).toEqual({});
    expect(validateTrafficRule(rule({ src: 'wan', dest: '', destPort: '22 80 8000-8100' }))).toEqual({});
    expect(
      validateTrafficRule(rule({ protocols: ['icmp'], destPort: '', family: 'ipv6', srcIp: 'fe80::/10' })),
    ).toEqual({});
    expect(validateTrafficRule(rule({ srcIp: '192.168.1.0/24', destIp: '8.8.8.8' }))).toEqual({});
  });

  it('checks every field', () => {
    expect(validateTrafficRule(rule({ src: '', dest: '' }))).toEqual({ dest: 'direction-invalid' });
    expect(validateTrafficRule(rule({ protocols: [] }))).toEqual({ protocols: 'protocols-empty' });
    expect(validateTrafficRule(rule({ protocols: ['icmp'] }))).toEqual({ destPort: 'port-needs-tcp-udp' });
    expect(validateTrafficRule(rule({ destPort: '23,25' }))).toEqual({ destPort: 'port-invalid' });
    expect(validateTrafficRule(rule({ srcIp: '300.1.1.1' }))).toEqual({ srcIp: 'ip-invalid' });
    expect(validateTrafficRule(rule({ family: 'ipv4', destIp: 'fd00::1' }))).toEqual({ destIp: 'ip-family' });
  });
});

describe('traffic rule changes', () => {
  const existing = (patch: Partial<TrafficRule> = {}): TrafficRule => ({
    section: 'r1',
    name: 'Old',
    src: 'lan',
    dest: 'wan',
    protocols: ['tcp'],
    srcIp: ['192.168.1.5'],
    destIp: [],
    destPort: '23',
    target: 'REJECT',
    family: 'ipv4',
    enabled: true,
    managed: false,
    extra: ['limit'],
    ...patch,
  });

  it('adds a rule; "the router itself" leaves src or dest out', () => {
    expect(trafficRuleChanges(rule({ src: 'wan', dest: '', family: 'ipv4' }))).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'firewall',
          type: 'rule',
          values: { name: 'Block-Telnet', src: 'wan', proto: 'tcp', dest_port: '23', target: 'REJECT', family: 'ipv4' },
        },
      },
    ]);
  });

  it('edits in place, removing what was cleared and keeping options the form does not show', () => {
    expect(trafficRuleChanges(rule({ src: '*', destPort: '' }), existing())).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'firewall',
          section: 'r1',
          values: { name: 'Block-Telnet', src: '*', dest: 'wan', proto: 'tcp', target: 'REJECT' },
        },
      },
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'r1', option: 'src_ip' } },
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'r1', option: 'dest_port' } },
      { object: 'uci', method: 'delete', params: { config: 'firewall', section: 'r1', option: 'family' } },
    ]);
  });

  it('refuses to touch the app’s own block rules', () => {
    expect(() => trafficRuleChanges(rule(), existing({ managed: true }))).toThrow(
      expect.objectContaining({ code: 'rule-managed' }),
    );
  });
});
