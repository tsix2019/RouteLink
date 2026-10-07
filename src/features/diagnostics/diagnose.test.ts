import {
  DemoApConnection,
  DemoConnection,
  DEMO_AP_ID,
  DEMO_AP_NAME,
  DEMO_ROUTER_ID,
} from '@/api/connection/demo/connection';
import type { RouterConnection } from '@/api/connection/types';
import { getGroupClients } from '@/api/group';
import { NativeError } from '@/api/http/errors';
import { UbusError } from '@/api/ubus/errors';

import { runDiagnosis, shareText, type SegmentResult } from './diagnose';

it('runs every segment against the demo network', async () => {
  const gateway = new DemoConnection(2026, () => 1_800_000_000_000, 0);
  const ap = new DemoApConnection(gateway);
  const members = [{ id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: ap }];
  const { clients } = await getGroupClients(gateway, { id: DEMO_ROUTER_ID, name: 'Demo' }, members);
  const tv = clients.find((c) => c.name === 'Living-Room-TV')!;
  const seen: SegmentResult[] = [];
  const results = await runDiagnosis(
    {
      gateway,
      members,
      clients,
      phoneIp: tv.ipv4,
      plugin: true,
      securityLevel: 'medium',
      pingRouter: async () => 12,
      http204: async () => true,
      now: () => 1_800_000_000_000,
    },
    (r) => seen.push(r),
  );
  expect(seen).toEqual(results);
  const by = Object.fromEntries(results.map((r) => [r.segment, r]));
  expect(results.map((r) => r.segment)).toEqual([
    'phone-wifi',
    'ap-uplink',
    'wan',
    'upstream',
    'dns',
    'internet',
    'stability',
    'wifi-security',
  ]);
  expect(by['phone-wifi'].facts).toMatchObject({ ap: DEMO_AP_NAME, rttMs: 12 });
  expect(by['ap-uplink'].verdict.status).toBe('ok');
  // The provider's network was down for a minute some hours ago: the WAN stayed up, stability warns.
  expect(by.wan.verdict.status).toBe('ok');
  expect(by.stability.verdict.status).toBe('warn');
  expect(by.dns.verdict.status).toBe('ok');
  expect(by.internet.verdict.status).toBe('ok');
  expect(by['wifi-security'].verdict.status).toBe('warn');
  const text = shareText(
    results,
    (s) => s,
    (s) => `[${s}]`,
    (a) => a,
  );
  expect(text.split('\n')[0]).toBe(`[${by['phone-wifi'].verdict.status}] phone-wifi`);
});

/** The router refuses (or cannot be reached for) the diagnostic commands and answers everything else. */
function failExec<T extends RouterConnection>(conn: T, error: () => Error): T {
  const call = conn.call.bind(conn);
  conn.call = (async (object: string, method: string, params?: Record<string, unknown>, options?: object) => {
    if (object === 'file' && method === 'exec') throw error();
    return call(object, method, params, options);
  }) as T['call'];
  return conn;
}

const denied = () => new UbusError('PERMISSION_DENIED', 'file exec');

async function run(o: { ap?: () => Error; gateway?: () => Error; http204?: boolean }) {
  const gateway = new DemoConnection(2026, () => 1_800_000_000_000, 0);
  const ap = new DemoApConnection(gateway);
  const members = [{ id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: o.ap ? failExec(ap, o.ap) : ap }];
  const { clients } = await getGroupClients(gateway, { id: DEMO_ROUTER_ID, name: 'Demo' }, members);
  const results = await runDiagnosis(
    {
      gateway: o.gateway ? failExec(gateway, o.gateway) : gateway,
      members,
      clients,
      plugin: false,
      pingRouter: async () => 12,
      http204: o.http204 === undefined ? undefined : async () => o.http204!,
      now: () => 1_800_000_000_000,
    },
    () => undefined,
  );
  return Object.fromEntries(results.map((r) => [r.segment, r]));
}

describe('router commands that could not run', () => {
  it('skips the checks instead of blaming the provider', async () => {
    const by = await run({ gateway: denied, ap: denied, http204: true });
    expect(by['ap-uplink'].verdict).toEqual({ status: 'skip', advice: [] });
    expect(by['ap-uplink'].facts).toMatchObject({ aps: `${DEMO_AP_NAME}: —`, notRun: 'ping' });
    expect(by.upstream.verdict).toEqual({ status: 'skip', advice: [] });
    expect(by.upstream.facts).toMatchObject({ notRun: 'ping' });
    expect(by.dns.verdict).toEqual({ status: 'skip', advice: [] });
    expect(by.dns.facts).toMatchObject({ notRun: 'nslookup' });
    // The phone's HTTP check went through: the internet is fine.
    expect(by.internet.verdict).toEqual({ status: 'ok', advice: [] });
    expect(by.internet.facts).toMatchObject({ lossPct: null, notRun: 'ping', http204: true });
  });

  it('still fails the internet on a failed HTTP check, and skips it with nothing measured', async () => {
    expect((await run({ gateway: denied, http204: false })).internet.verdict.status).toBe('fail');
    expect((await run({ gateway: denied })).internet.verdict.status).toBe('skip');
  });

  it('fails an access point the phone cannot reach at all', async () => {
    const by = await run({ ap: () => new NativeError('ERR_UNREACHABLE', 'no route') });
    expect(by['ap-uplink'].verdict).toEqual({ status: 'fail', advice: ['check-ap-cable'] });
    expect(by['ap-uplink'].facts).toMatchObject({ aps: `${DEMO_AP_NAME}: ✕` });
    expect(by['ap-uplink'].facts.notRun).toBeUndefined();
    expect(by.upstream.verdict.status).toBe('ok');
  });
});
