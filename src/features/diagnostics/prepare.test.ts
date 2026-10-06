import {
  DemoApConnection,
  DemoConnection,
  DEMO_AP_ID,
  DEMO_AP_NAME,
  DEMO_ROUTER_ID,
} from '@/api/connection/demo/connection';

import { checkHttp204, DEMO_PHONE, groupSecurityLevel, prepareDiagnosis, timedPing } from './prepare';

const NOW = 1_800_000_000_000;

function demo() {
  const gateway = new DemoConnection(2026, () => NOW, 0);
  const ap = new DemoApConnection(gateway);
  return { gateway, ap, members: [{ id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: ap }] };
}

describe('prepareDiagnosis', () => {
  it('stands in the demo phone and simulates the phone-side checks', async () => {
    const { gateway, members } = demo();
    const { input, clients } = await prepareDiagnosis({
      gateway,
      gatewayRef: { id: DEMO_ROUTER_ID, name: 'Demo' },
      members,
      phoneIp: async () => '10.0.0.99',
      wait: async () => undefined,
    });
    const phone = clients.find((c) => c.name === DEMO_PHONE || c.hostname === DEMO_PHONE)!;
    expect(input.phoneIp).toBe(phone.ipv4);
    expect(input.plugin).toBe(true);
    expect(input.securityLevel).toBeDefined();
    await expect(input.pingRouter()).resolves.toBeGreaterThan(0);
    await expect(input.http204!()).resolves.toBe(true);
  });

  it('keeps the real phone address when the network has it, and leaves out members without a connection', async () => {
    const { gateway } = demo();
    const all = await prepareDiagnosis({
      gateway,
      gatewayRef: { id: DEMO_ROUTER_ID, name: 'Demo' },
      members: [{ id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: null }],
      phoneIp: async () => null,
      wait: async () => undefined,
    });
    const tv = all.clients.find((c) => c.name === 'Living-Room-TV')!;
    const { input } = await prepareDiagnosis({
      gateway,
      gatewayRef: { id: DEMO_ROUTER_ID, name: 'Demo' },
      members: [],
      phoneIp: async () => tv.ipv4 ?? null,
      wait: async () => undefined,
    });
    expect(input.phoneIp).toBe(tv.ipv4);
  });
});

it('rates the group by its weakest enabled access-point network', async () => {
  const { gateway, ap } = demo();
  const level = await groupSecurityLevel([gateway, ap]);
  expect(['high', 'medium', 'low', 'danger']).toContain(level);
  const failing = { call: async () => Promise.reject(new Error('offline')) } as unknown as DemoConnection;
  expect(await groupSecurityLevel([failing])).toBeUndefined();
});

describe('checkHttp204', () => {
  const response = (status: number) => ({ status }) as Response;

  it('passes when any endpoint answers 204', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes('a.example')) throw new Error('blocked');
      return response(url.includes('b.example') ? 204 : 200);
    }) as unknown as typeof fetch;
    await expect(checkHttp204(fetchFn, ['https://a.example/x', 'https://b.example/x'])).resolves.toBe(true);
    await expect(checkHttp204(fetchFn, ['https://a.example/x', 'https://c.example/x'])).resolves.toBe(false);
    await expect(checkHttp204(fetchFn, [])).resolves.toBe(false);
  });

  it('gives up after the timeout', async () => {
    const hang = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    await expect(checkHttp204(hang, ['https://slow.example/x'], 10)).resolves.toBe(false);
  });
});

it('times a router ping and reports failures as null', async () => {
  let now = 0;
  const clock = () => now;
  const ok = timedPing(async () => {
    now += 12;
    return true;
  }, clock);
  expect(await ok()).toBe(12);
  expect(await timedPing(async () => false, clock)()).toBeNull();
  expect(await timedPing(async () => Promise.reject(new Error('x')), clock)()).toBeNull();
});
