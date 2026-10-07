import {
  DemoApConnection,
  DemoConnection,
  DEMO_AP_ID,
  DEMO_AP_NAME,
  DEMO_ROUTER_ID,
} from '@/api/connection/demo/connection';
import { getGroupClients } from '@/api/group';

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
