import type { RouterProfile } from '@/state/routers';

import { DemoApConnection, DemoConnection } from '../connection/demo/connection';
import { readGroupHints, suggestGateway } from './suggest';

const profile = (id: string, baseUrl: string, extra: Partial<RouterProfile> = {}): RouterProfile => ({
  id,
  name: id,
  baseUrl,
  username: 'root',
  savePassword: true,
  order: 0,
  createdAt: 0,
  ...extra,
});

describe('suggestGateway', () => {
  const routers = [
    profile('main', 'https://192.168.8.1'),
    profile('other', 'http://10.0.0.1', { role: 'gateway' }),
    profile('old-ap', 'http://192.168.8.3', { role: 'ap', gatewayId: 'main' }),
    profile('new', 'http://192.168.8.2'),
  ];

  it('suggests the saved router its default route points at, when it has Wi-Fi', () => {
    expect(suggestGateway({ nexthop: '192.168.8.1', hasWifi: true }, routers, 'new')?.id).toBe('main');
    expect(suggestGateway({ nexthop: '192.168.8.1', hasWifi: false }, routers, 'new')).toBeUndefined();
    expect(suggestGateway({ nexthop: '192.168.8.3', hasWifi: true }, routers, 'new')).toBeUndefined();
  });

  it('trusts the plugin role, falling back to the only gateway', () => {
    expect(suggestGateway({ hasWifi: false, pluginRoles: ['ap'] }, routers, 'new')?.id).toBe('other');
    expect(suggestGateway({ hasWifi: true, pluginRoles: ['gateway', 'ap'] }, routers, 'new')).toBeUndefined();
    expect(suggestGateway({ nexthop: '192.168.8.1', hasWifi: false, pluginRoles: ['ap'] }, routers, 'new')?.id).toBe(
      'main',
    );
  });
});

it('reads the hints from a router', async () => {
  const gateway = new DemoConnection(2026, () => 1_800_000_000_000, 0);
  await expect(readGroupHints(gateway)).resolves.toEqual({
    nexthop: '203.0.113.1',
    hasWifi: true,
    pluginRoles: ['gateway', 'ap'],
  });
  await expect(readGroupHints(new DemoApConnection(gateway))).resolves.toMatchObject({
    hasWifi: true,
    pluginRoles: ['ap'],
  });
});
