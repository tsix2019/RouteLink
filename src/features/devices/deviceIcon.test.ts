import { deviceIcon } from './deviceIcon';

const icon = (name: string, vendor: string | null = null, connection: 'wifi' | 'wired' | 'unknown' = 'wifi') =>
  deviceIcon({ name, hostname: undefined, vendor, connection });

it.each([
  ['iPhone-16-Pro', null, 'phone'],
  ['iPad', null, 'tablet'],
  ['MacBook-Air', null, 'laptop'],
  ['Living-Room-TV', null, 'tv'],
  ['HP-LaserJet', null, 'printer'],
  ['Nintendo-Switch', null, 'game'],
  ['Front-Camera', null, 'camera'],
  ['Echo-Dot', null, 'speaker'],
  ['Smart-Plug', null, 'plug'],
  ['NAS', null, 'server'],
  ['Desk-PC', null, 'desktop'],
  ['客厅电视', 'LG Electronics', 'wifi'],
  ['DA:A1:19:00:00:01', null, 'wifi'],
] as const)('%s (%s) → %s', (name, vendor, expected) => {
  expect(icon(name, vendor)).toBe(expected);
});

it('uses the vendor when the name says nothing', () => {
  expect(icon('unknown-host', 'Espressif')).toBe('plug');
  expect(icon('box', 'Synology')).toBe('server');
});

it('falls back to the connection type', () => {
  expect(icon('box', null, 'wired')).toBe('ethernet');
  expect(icon('box', null, 'unknown')).toBe('unknownDevice');
});
