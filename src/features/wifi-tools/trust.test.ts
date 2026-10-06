import type { UciSection } from '@/api/uci';

import { markChanges, migrationUpdates, parseDeviceMarks } from './trust';

const section = (name: string, index: number, values: Record<string, string>): UciSection => ({
  '.name': name,
  '.type': 'device',
  '.anonymous': true,
  '.index': index,
  ...values,
});

describe('parseDeviceMarks', () => {
  it('reads device sections, normalises MACs, later sections win', () => {
    const marks = parseDeviceMarks({
      main: { '.name': 'main', '.type': 'routelink' },
      cfg01: section('cfg01', 1, { mac: 'aa-bb-cc-dd-ee-01', trusted: '1' }),
      cfg02: section('cfg02', 2, { mac: 'AA:BB:CC:DD:EE:02', watch: '1' }),
      cfg03: section('cfg03', 3, { mac: 'aa:bb:cc:dd:ee:01', trusted: '0', watch: '1' }),
      bad: section('bad', 4, { mac: 'nope', trusted: '1' }),
    });
    expect(marks).toEqual([
      { mac: 'AA:BB:CC:DD:EE:01', trusted: false, watch: true, section: 'cfg03' },
      { mac: 'AA:BB:CC:DD:EE:02', trusted: false, watch: true, section: 'cfg02' },
    ]);
  });
});

describe('markChanges', () => {
  const current = [
    { mac: 'AA:BB:CC:DD:EE:01', trusted: true, watch: false, section: 'cfg01' },
    { mac: 'AA:BB:CC:DD:EE:02', trusted: true, watch: true, section: 'cfg02' },
  ];

  it('adds, updates and deletes sections', () => {
    expect(
      markChanges(current, [
        { mac: 'aa:bb:cc:dd:ee:03', trusted: true },
        { mac: 'AA:BB:CC:DD:EE:01', trusted: false },
        { mac: 'AA:BB:CC:DD:EE:02', trusted: false },
      ]),
    ).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: { config: 'routelink', type: 'device', values: { mac: 'AA:BB:CC:DD:EE:03', trusted: '1', watch: '0' } },
      },
      { object: 'uci', method: 'delete', params: { config: 'routelink', section: 'cfg01' } },
      {
        object: 'uci',
        method: 'set',
        params: { config: 'routelink', section: 'cfg02', values: { trusted: '0', watch: '1' } },
      },
    ]);
  });

  it('skips updates that change nothing', () => {
    expect(markChanges(current, [{ mac: 'AA:BB:CC:DD:EE:01', trusted: true }, { mac: 'x', trusted: true }])).toEqual(
      [],
    );
    expect(markChanges([], [{ mac: 'AA:BB:CC:DD:EE:09', trusted: false }])).toEqual([]);
  });
});

it('moves only devices the router does not trust yet', () => {
  expect(
    migrationUpdates(
      ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'],
      [{ mac: 'AA:BB:CC:DD:EE:01', trusted: true, watch: false, section: 'cfg01' }],
    ),
  ).toEqual([{ mac: 'AA:BB:CC:DD:EE:02', trusted: true }]);
});
