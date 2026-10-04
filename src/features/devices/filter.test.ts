import type { Client } from '@/api/services/clients';

import { filterClients } from './filter';

const c = (mac: string, over: Partial<Client>): Client => ({
  mac,
  name: mac,
  vendor: null,
  randomizedMac: false,
  ipv6: [],
  online: true,
  onlineSource: 'neighbor',
  connection: 'wired',
  isStatic: false,
  isBlocked: false,
  ...over,
});

const list = [
  c('AA:00:00:00:00:01', { name: 'iPhone', connection: 'wifi', ipv4: '192.168.1.20', vendor: 'Apple' }),
  c('AA:00:00:00:00:02', { name: 'NAS', ipv4: '192.168.1.5', vendor: 'Synology' }),
  c('AA:00:00:00:00:03', { name: 'Old laptop', online: false, connection: 'wifi' }),
];

it('filters by status and link type', () => {
  expect(filterClients(list, '', 'online', 'all').map((x) => x.name)).toEqual(['iPhone', 'NAS']);
  expect(filterClients(list, '', 'offline', 'all').map((x) => x.name)).toEqual(['Old laptop']);
  expect(filterClients(list, '', 'all', 'wifi').map((x) => x.name)).toEqual(['iPhone', 'Old laptop']);
  expect(filterClients(list, '', 'all', 'wired').map((x) => x.name)).toEqual(['NAS']);
});

it('searches name, IP, MAC and vendor case-insensitively', () => {
  expect(filterClients(list, 'syno', 'all', 'all').map((x) => x.name)).toEqual(['NAS']);
  expect(filterClients(list, '192.168.1.2', 'all', 'all').map((x) => x.name)).toEqual(['iPhone']);
  expect(filterClients(list, 'aa:00:00:00:00:03', 'all', 'all').map((x) => x.name)).toEqual(['Old laptop']);
  expect(filterClients(list, '  ', 'all', 'all')).toHaveLength(3);
});
