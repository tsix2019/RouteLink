import { compare, type WatchMemory } from './watch';

const phone = { mac: 'aa:bb:cc:00:00:01', name: 'Phone' };
const laptop = { mac: 'aa:bb:cc:00:00:02', name: 'Laptop' };
const guest = { mac: 'de:ad:be:ef:00:03', name: 'Unknown' };

describe('background check', () => {
  it('only learns on the first reading', () => {
    const { alerts, next } = compare(undefined, { reachable: true, devices: [phone, laptop] }, 1);
    expect(alerts).toEqual([]);
    expect(next).toEqual({ reachable: true, knownMacs: ['AA:BB:CC:00:00:01', 'AA:BB:CC:00:00:02'], checkedAt: 1 });
  });

  it('tells when the router goes down and comes back, once each', () => {
    let memory: WatchMemory = { reachable: true, knownMacs: ['AA:BB:CC:00:00:01'], checkedAt: 1 };
    const down = compare(memory, { reachable: false }, 2);
    expect(down.alerts).toEqual([{ kind: 'offline' }]);
    // Still down: nothing new to say; the devices it knew are kept.
    const still = compare(down.next, { reachable: false }, 3);
    expect(still.alerts).toEqual([]);
    expect(still.next.knownMacs).toEqual(['AA:BB:CC:00:00:01']);
    memory = still.next;
    expect(compare(memory, { reachable: true, devices: [phone] }, 4).alerts).toEqual([{ kind: 'online' }]);
  });

  it('tells about a device never seen before, by name', () => {
    const memory: WatchMemory = {
      reachable: true,
      knownMacs: ['AA:BB:CC:00:00:01', 'AA:BB:CC:00:00:02'],
      checkedAt: 1,
    };
    const { alerts, next } = compare(memory, { reachable: true, devices: [phone, laptop, guest] }, 2);
    expect(alerts).toEqual([{ kind: 'new-device', mac: 'DE:AD:BE:EF:00:03', name: 'Unknown' }]);
    expect(compare(next, { reachable: true, devices: [phone, guest] }, 3).alerts).toEqual([]);
  });
});
