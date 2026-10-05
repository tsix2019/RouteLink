import { FixtureConnection, fail, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  ddnsChanges,
  deleteDdnsChanges,
  getDdns,
  parseDdns,
  providerNeeds,
  readProvider,
  saveDdns,
  validateDdns,
  type DdnsInput,
} from './ddns';

const recorded = (v = '24.10.8') =>
  (loadFixture(`openwrt-${v}`, 'uci.get.ddns') as { data: { values: Record<string, UciSection> } }).data.values;
const DUCKDNS = (
  loadFixture('openwrt-24.10.8', 'file.read.usr-share-ddns-default-duckdns-org-json') as {
    data: { data: string };
  }
).data.data;

const home: UciSection = {
  '.name': 'home',
  '.type': 'service',
  '.index': 3,
  enabled: '1',
  service_name: 'duckdns.org',
  domain: 'myhome.duckdns.org',
  lookup_host: 'myhome.duckdns.org',
  password: 'token-123',
  interface: 'wan',
  ip_source: 'network',
  ip_network: 'wan',
};

describe('parseDdns', () => {
  it('hides the untouched examples', () => {
    expect(parseDdns(recorded(), {})).toEqual([]);
    expect(parseDdns(recorded('25.12.5'), {})).toEqual([]);
  });

  it('reads a service with its status', () => {
    const status = {
      home: { ip: '203.0.113.45', last_update: '2026-10-05 09:12', next_update: '2026-10-08 09:22', pid: 2345 },
    };
    expect(parseDdns({ ...recorded(), home }, status)).toEqual([
      {
        section: 'home',
        enabled: true,
        provider: 'duckdns.org',
        domain: 'myhome.duckdns.org',
        username: '',
        password: 'token-123',
        ipv6: false,
        source: 'wan',
        status: { ip: '203.0.113.45', lastUpdate: '2026-10-05 09:12', next: '2026-10-08 09:22', running: true },
      },
    ]);
  });

  it('turns the status words into states, and a custom URL into its own provider', () => {
    const custom: UciSection = {
      '.name': 'custom',
      '.type': 'service',
      enabled: '0',
      update_url: 'http://example.net/update?host=[DOMAIN]&ip=[IP]',
      domain: 'a.example.net',
      ip_source: 'web',
      use_ipv6: '1',
    };
    const [s] = parseDdns({ custom }, { custom: { ip: null, last_update: null, next_update: 'Disabled', pid: null } });
    expect(s).toMatchObject({
      provider: '',
      updateUrl: 'http://example.net/update?host=[DOMAIN]&ip=[IP]',
      source: 'web',
      ipv6: true,
      status: { next: 'disabled', running: false },
    });
  });
});

describe('providers', () => {
  it('knows from the update URL which fields a provider needs', () => {
    expect(providerNeeds(DUCKDNS)).toEqual({ username: false, password: true, ipv4: true, ipv6: true });
    expect(
      providerNeeds('{"name":"x","ipv4":{"url":"http://[USERNAME]:[PASSWORD]@x/update?h=[DOMAIN]&ip=[IP]"}}'),
    ).toEqual({ username: true, password: true, ipv4: true, ipv6: false });
    // Script-based providers (Cloudflare) take both.
    expect(providerNeeds('{"name":"cf","ipv4":{"url":"update_cloudflare_com_v4.sh"}}')).toEqual({
      username: true,
      password: true,
      ipv4: true,
      ipv6: false,
    });
  });

  it('reads one provider file', async () => {
    const conn = new FixtureConnection('openwrt-24.10.8');
    expect(await readProvider(conn, 'duckdns.org')).toEqual({
      username: false,
      password: true,
      ipv4: true,
      ipv6: true,
    });
  });
});

describe('validateDdns and ddnsChanges', () => {
  const input: DdnsInput = {
    provider: 'duckdns.org',
    updateUrl: '',
    domain: 'myhome.duckdns.org',
    username: '',
    password: 'token-123',
    ipv6: false,
    source: 'wan',
    enabled: true,
  };
  const needs = { username: false, password: true, ipv4: true, ipv6: true };

  it('checks the fields the provider needs', () => {
    expect(validateDdns(input, needs)).toEqual({});
    expect(validateDdns({ ...input, domain: 'not a host', password: '' }, needs)).toEqual({
      domain: 'domain-invalid',
      password: 'required',
    });
    expect(validateDdns({ ...input, ipv6: true }, { ...needs, ipv6: false })).toEqual({ ipv6: 'unsupported' });
    expect(validateDdns({ ...input, provider: '', updateUrl: 'ftp://x' }, null)).toEqual({ updateUrl: 'url-invalid' });
  });

  it('adds a service named after the domain, watching the WAN', () => {
    expect(ddnsChanges(input, ['global'])).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'ddns',
          type: 'service',
          name: 'myhome_duckdns_org',
          values: {
            enabled: '1',
            service_name: 'duckdns.org',
            domain: 'myhome.duckdns.org',
            lookup_host: 'myhome.duckdns.org',
            password: 'token-123',
            use_ipv6: '0',
            interface: 'wan',
            ip_source: 'network',
            ip_network: 'wan',
          },
        },
      },
    ]);
  });

  it('uses wan6 for IPv6, web detection behind another router, Cloudflare-style zones in lookups', () => {
    const [v6] = ddnsChanges({ ...input, ipv6: true }, []);
    expect((v6.params as { values: Record<string, string> }).values).toMatchObject({
      use_ipv6: '1',
      interface: 'wan6',
      ip_network: 'wan6',
    });
    const [web] = ddnsChanges({ ...input, source: 'web', domain: 'home@example.com', username: 'Bearer' }, []);
    const values = (web.params as { values: Record<string, string> }).values;
    expect(values).toMatchObject({ ip_source: 'web', interface: 'wan', lookup_host: 'home.example.com' });
    expect(values.ip_network).toBeUndefined();
  });

  it('edits in place and removes options that no longer apply', () => {
    const [existing] = parseDdns({ home }, {});
    const changes = ddnsChanges(
      { ...input, source: 'web', provider: '', updateUrl: 'https://x.example/u?ip=[IP]' },
      [],
      existing,
    );
    expect(changes[0]).toEqual({
      object: 'uci',
      method: 'set',
      params: {
        config: 'ddns',
        section: 'home',
        values: expect.objectContaining({ update_url: 'https://x.example/u?ip=[IP]', ip_source: 'web' }),
      },
    });
    expect(changes.slice(1)).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'ddns', section: 'home', option: 'service_name' } },
      { object: 'uci', method: 'delete', params: { config: 'ddns', section: 'home', option: 'ip_network' } },
    ]);
    expect(deleteDdnsChanges(existing)).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'ddns', section: 'home' } },
    ]);
  });
});

describe('router calls', () => {
  it('reads services, status and the installed providers', async () => {
    const state = await getDdns(new FixtureConnection('openwrt-24.10.8'));
    expect(state.installed).toBe(true);
    expect(state.services).toEqual([]);
    expect(state.providers).toContain('duckdns.org');
    expect(state.providers).toEqual([...state.providers].sort());
    const missing = new FixtureConnection('openwrt-24.10.8').override('uci.get.ddns', fail('NOT_FOUND'));
    expect((await getDdns(missing)).installed).toBe(false);
  });

  it('applies directly and restarts ddns', async () => {
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.add', ok({ section: 'x' }))
      .override('uci.apply', ok({}))
      .override('rc.init', ok({}));
    const input: DdnsInput = {
      provider: 'duckdns.org',
      updateUrl: '',
      domain: 'a.duckdns.org',
      username: '',
      password: 't',
      ipv6: false,
      source: 'wan',
      enabled: true,
    };
    await saveDdns(conn, ddnsChanges(input, []));
    expect(conn.calls.map((c) => `${c.object}.${c.method}`)).toEqual(['uci.add', 'uci.apply', 'rc.init', 'rc.init']);
    expect(conn.calls.slice(2).map((c) => c.params)).toEqual([
      { name: 'ddns', action: 'enable' },
      { name: 'ddns', action: 'restart' },
    ]);
  });
});
