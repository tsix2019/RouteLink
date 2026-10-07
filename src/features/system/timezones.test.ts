import type { Timezone } from '@/api/services/system-settings';

import { filterZones } from './timezones';

const zones: Timezone[] = [
  { zonename: 'UTC', tz: 'UTC0' },
  { zonename: 'Asia/Shanghai', tz: 'CST-8' },
  { zonename: 'Asia/Hong Kong', tz: 'HKT-8' },
  { zonename: 'America/New York', tz: 'EST5EDT,M3.2.0,M11.1.0' },
  { zonename: 'Europe/Berlin', tz: 'CET-1CEST,M3.5.0,M10.5.0/3' },
];
const names = (list: Timezone[]) => list.map((z) => z.zonename);

describe('filterZones', () => {
  it('matches anywhere in the name, ignoring case', () => {
    expect(names(filterZones(zones, 'shang'))).toEqual(['Asia/Shanghai']);
    expect(names(filterZones(zones, 'ASIA/'))).toEqual(['Asia/Shanghai', 'Asia/Hong Kong']);
  });

  it('matches the TZ string', () => {
    expect(names(filterZones(zones, 'cst-8'))).toEqual(['Asia/Shanghai']);
    expect(names(filterZones(zones, 'CEST'))).toEqual(['Europe/Berlin']);
  });

  it('treats spaces and underscores alike', () => {
    expect(names(filterZones(zones, 'new_york'))).toEqual(['America/New York']);
    expect(names(filterZones(zones, 'hong kong'))).toEqual(['Asia/Hong Kong']);
  });

  it('returns every zone for an empty or blank query', () => {
    expect(filterZones(zones, '')).toBe(zones);
    expect(filterZones(zones, '   ')).toBe(zones);
  });

  it('is empty when nothing matches', () => {
    expect(filterZones(zones, 'mars')).toEqual([]);
  });
});
