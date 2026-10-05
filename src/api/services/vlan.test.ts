import { FixtureConnection, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  canDisableFiltering,
  disableFilteringChanges,
  enableFilteringChanges,
  getVlans,
  parseVlans,
  validateVlans,
  vlanChanges,
  type BoardJson,
  type DsaVlans,
  type SwitchVlans,
  type Vlan,
} from './vlan';

const sec = (name: string, type: string, values: Record<string, string | string[]>, index = 0): UciSection => ({
  '.name': name,
  '.type': type,
  '.index': index,
  ...values,
});
const net = (...sections: UciSection[]) => Object.fromEntries(sections.map((s) => [s['.name'], s]));

/** QEMU x86 (24.10.8): br-lan over eth0, eth2 and eth3, no VLANs yet. */
const recorded = () => {
  const values = (loadFixture('openwrt-24.10.8', 'uci.get.network') as { data: { values: Record<string, UciSection> } })
    .data.values;
  const board = (loadFixture('openwrt-24.10.8', 'luci-rpc.getBoardJSON') as { data: BoardJson }).data;
  return { values, board };
};

/** A DSA router after LuCI's "Enable VLAN filtering", with an IoT VLAN trunked to lan4. */
const dsa = net(
  sec(
    'dev_lan',
    'device',
    { name: 'br-lan', type: 'bridge', ports: ['lan1', 'lan2', 'lan3', 'lan4'], vlan_filtering: '1' },
    1,
  ),
  sec('vlan1', 'bridge-vlan', { device: 'br-lan', vlan: '1', ports: ['lan1:u*', 'lan2:u*', 'lan3:u*', 'lan4:t'] }, 2),
  sec('vlan10', 'bridge-vlan', { device: 'br-lan', vlan: '10', ports: ['lan3', 'lan4:t'] }, 3),
  sec('lan', 'interface', { device: 'br-lan.1', proto: 'static', ipaddr: '192.168.1.1' }, 4),
  sec('iot', 'interface', { device: 'br-lan.10', proto: 'static', ipaddr: '192.168.10.1' }, 5),
  sec('wan', 'interface', { device: 'wan', proto: 'dhcp' }, 6),
);

/** A single-CPU-port swconfig router (ramips, `ucidef_add_switch "switch0" "0:lan" … "4:wan" "6@eth0"`). */
const swBoard: BoardJson = {
  switch: {
    switch0: {
      enable: true,
      reset: true,
      ports: [
        { num: 0, role: 'lan' },
        { num: 1, role: 'lan' },
        { num: 2, role: 'lan' },
        { num: 3, role: 'lan' },
        { num: 4, role: 'wan' },
        { num: 6, device: 'eth0', need_tag: false },
      ],
    },
  },
};
const sw = net(
  sec('switch0', 'switch', { name: 'switch0', reset: '1', enable_vlan: '1' }, 1),
  sec('sv1', 'switch_vlan', { device: 'switch0', vlan: '1', ports: '0 1 2 3 6t' }, 2),
  sec('sv2', 'switch_vlan', { device: 'switch0', vlan: '2', ports: '4 6t' }, 3),
  sec('lan', 'interface', { device: 'eth0.1', proto: 'static' }, 4),
  sec('wan', 'interface', { device: 'eth0.2', proto: 'dhcp' }, 5),
);

/** Two CPU ports, one per role, untagged (ath79 Archer C7: "0@eth1" "2:lan:4" … "6@eth0" "1:wan"). */
const dualBoard: BoardJson = {
  switch: {
    switch0: {
      ports: [
        { num: 0, device: 'eth1', need_tag: false },
        { num: 2, role: 'lan', index: 4 },
        { num: 3, role: 'lan', index: 3 },
        { num: 4, role: 'lan', index: 2 },
        { num: 5, role: 'lan', index: 1 },
        { num: 6, device: 'eth0', need_tag: false },
        { num: 1, role: 'wan' },
      ],
    },
  },
};
const dual = net(
  sec('switch0', 'switch', { name: 'switch0' }, 1),
  sec('sv1', 'switch_vlan', { device: 'switch0', vlan: '1', ports: '2 3 4 5 0' }, 2),
  sec('sv2', 'switch_vlan', { device: 'switch0', vlan: '2', ports: '1 6' }, 3),
  sec('lan', 'interface', { ifname: 'eth1', proto: 'static' }, 4),
  sec('wan', 'interface', { ifname: 'eth0', proto: 'dhcp' }, 5),
);

const vlanOf = (s: { vlans: Vlan[] }, id: number) => s.vlans.find((v) => v.id === id)!;

describe('parseVlans: DSA', () => {
  it('reads the recorded QEMU bridge without VLANs', () => {
    const { values, board } = recorded();
    const s = parseVlans(values, board) as DsaVlans;
    expect(s).toMatchObject({ kind: 'dsa', bridge: 'br-lan', filtering: false, vlans: [] });
    expect(s.ports.map((p) => p.id)).toEqual(['eth0', 'eth2', 'eth3']);
    expect(s.bridgeUsers).toEqual(['lan']);
  });

  it('reads members, PVIDs and the interfaces on each VLAN', () => {
    const s = parseVlans(dsa, {}) as DsaVlans;
    expect(s.filtering).toBe(true);
    expect(vlanOf(s, 1)).toEqual({
      section: 'vlan1',
      id: 1,
      usedBy: ['lan'],
      members: {
        lan1: { mode: 'untagged', pvid: true },
        lan2: { mode: 'untagged', pvid: true },
        lan3: { mode: 'untagged', pvid: true },
        lan4: { mode: 'tagged', pvid: false },
      },
    });
    // No flags means tagged.
    expect(vlanOf(s, 10).members.lan3).toEqual({ mode: 'tagged', pvid: false });
    expect(vlanOf(s, 10).members.lan1).toEqual({ mode: 'off', pvid: false });
    expect(vlanOf(s, 10).usedBy).toEqual(['iot']);
  });

  it('is "none" without a bridge or a switch', () => {
    expect(parseVlans(net(sec('wan', 'interface', { device: 'eth0', proto: 'dhcp' })), {}).kind).toBe('none');
  });
});

describe('parseVlans: swconfig', () => {
  it('labels ports like LuCI and finds the CPU port', () => {
    const s = parseVlans(sw, swBoard) as SwitchVlans;
    expect(s.kind).toBe('swconfig');
    expect(s.ports.map((p) => [p.id, p.label, p.cpu])).toEqual([
      ['6', 'CPU (eth0)', true],
      ['0', 'LAN 1', false],
      ['1', 'LAN 2', false],
      ['2', 'LAN 3', false],
      ['3', 'LAN 4', false],
      ['4', 'WAN', false],
    ]);
    expect(vlanOf(s, 1).members).toMatchObject({ '0': { mode: 'untagged' }, '6': { mode: 'tagged' } });
    expect(vlanOf(s, 1).usedBy).toEqual(['lan']);
    expect(vlanOf(s, 2).usedBy).toEqual(['wan']);
  });

  it('finds interfaces on an untagged CPU port and sorts LAN ports by their index', () => {
    const s = parseVlans(dual, dualBoard) as SwitchVlans;
    expect(s.ports.map((p) => p.label)).toEqual([
      'CPU (eth1)',
      'CPU (eth0)',
      'LAN 1',
      'LAN 2',
      'LAN 3',
      'LAN 4',
      'WAN',
    ]);
    expect(s.ports.find((p) => p.label === 'LAN 1')!.id).toBe('5');
    expect(vlanOf(s, 1).usedBy).toEqual(['lan']);
    expect(vlanOf(s, 2).usedBy).toEqual(['wan']);
  });

  it('reads VLAN IDs from the vid option when the switch has one', () => {
    const values = net(...Object.values(sw).map((x) => (x['.name'] === 'sv2' ? { ...x, vid: '20' } : x)));
    const s = parseVlans(values, swBoard, { vid_option: 'vid', num_vlans: 16 }) as SwitchVlans;
    expect(s.vlans.map((v) => v.id)).toEqual([1, 20]);
    expect(s.maxVid).toBe(4094);
  });
});

describe('validateVlans', () => {
  it('accepts the samples as they are', () => {
    const d = parseVlans(dsa, {}) as DsaVlans;
    expect(validateVlans(d, d.vlans)).toEqual([]);
    const s = parseVlans(sw, swBoard) as SwitchVlans;
    expect(validateVlans(s, s.vlans)).toEqual([]);
  });

  it('finds a port untagged twice, a second PVID, bad and duplicate IDs and an empty VLAN', () => {
    const d = parseVlans(dsa, {}) as DsaVlans;
    const v10 = vlanOf(d, 10);
    const errors = validateVlans(d, [
      vlanOf(d, 1),
      { ...v10, members: { ...v10.members, lan1: { mode: 'untagged', pvid: true } } },
      { id: 10, members: { lan2: { mode: 'tagged', pvid: false } }, usedBy: [] },
      { id: 4095, members: { lan2: { mode: 'tagged', pvid: false } }, usedBy: [] },
      { id: 30, members: {}, usedBy: [] },
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        { code: 'multiple-untagged', port: 'lan1' },
        { code: 'multiple-pvid', port: 'lan1' },
        { code: 'id-duplicate', vlan: 10 },
        { code: 'id-range', vlan: 4095 },
        { code: 'empty', vlan: 30 },
      ]),
    );
  });

  it('does not let a port that must be tagged go untagged', () => {
    const board: BoardJson = {
      switch: {
        switch0: {
          ports: [
            { num: 0, role: 'lan' },
            { num: 5, device: 'eth0', need_tag: true },
          ],
        },
      },
    };
    const values = net(
      sec('switch0', 'switch', { name: 'switch0' }),
      sec('sv1', 'switch_vlan', { device: 'switch0', vlan: '1', ports: '0 5' }),
    );
    const s = parseVlans(values, board) as SwitchVlans;
    expect(validateVlans(s, s.vlans)).toEqual([{ code: 'needs-tag', port: '5' }]);
  });
});

describe('vlanChanges', () => {
  it('DSA: writes the ports list of a changed VLAN with u, t and *', () => {
    const d = parseVlans(dsa, {}) as DsaVlans;
    const v10 = vlanOf(d, 10);
    const changes = vlanChanges(d, [
      vlanOf(d, 1),
      { ...v10, members: { ...v10.members, lan2: { mode: 'tagged', pvid: false } } },
    ]);
    expect(changes).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'network', section: 'vlan10', values: { ports: ['lan2:t', 'lan3:t', 'lan4:t'] } },
      },
    ]);
  });

  it('DSA: adds a VLAN on the bridge and removes an unused one', () => {
    const d = parseVlans(dsa, {}) as DsaVlans;
    const guest: Vlan = { id: 20, members: { lan2: { mode: 'tagged', pvid: false } }, usedBy: [] };
    expect(vlanChanges(d, [vlanOf(d, 1), vlanOf(d, 10), guest])).toEqual([
      {
        object: 'uci',
        method: 'add',
        params: { config: 'network', type: 'bridge-vlan', values: { device: 'br-lan', vlan: '20', ports: ['lan2:t'] } },
      },
    ]);
    const withoutIot = parseVlans(net(...Object.values(dsa).filter((s) => s['.name'] !== 'iot')), {}) as DsaVlans;
    expect(vlanChanges(withoutIot, [vlanOf(withoutIot, 1)])).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'vlan10' } },
    ]);
  });

  it('refuses to remove a VLAN that an interface uses', () => {
    const d = parseVlans(dsa, {}) as DsaVlans;
    expect(() => vlanChanges(d, [vlanOf(d, 1)])).toThrow(expect.objectContaining({ code: 'vlan-in-use' }));
  });

  it('swconfig: keeps the CPU port, writes a string, and tags the CPU port on a new VLAN', () => {
    const s = parseVlans(sw, swBoard) as SwitchVlans;
    const v1 = vlanOf(s, 1);
    const changes = vlanChanges(s, [
      { ...v1, members: { ...v1.members, '3': { mode: 'off', pvid: false } } },
      vlanOf(s, 2),
      { id: 3, members: { '3': { mode: 'untagged', pvid: false } }, usedBy: [] },
    ]);
    expect(changes).toEqual([
      { object: 'uci', method: 'set', params: { config: 'network', section: 'sv1', values: { ports: '0 1 2 6t' } } },
      {
        object: 'uci',
        method: 'add',
        params: { config: 'network', type: 'switch_vlan', values: { device: 'switch0', vlan: '3', ports: '3 6t' } },
      },
    ]);
  });

  it('swconfig with VIDs: a new VLAN gets the next table index and its own VID', () => {
    const s = parseVlans(sw, swBoard, { vid_option: 'vid', vlan4k_option: 'enable_vlan4k' }) as SwitchVlans;
    const changes = vlanChanges(s, [
      ...s.vlans,
      { id: 100, members: { '2': { mode: 'tagged', pvid: false } }, usedBy: [] },
    ]);
    expect(changes).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'network', section: 'switch0', values: { enable_vlan4k: '1' } },
      },
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'network',
          type: 'switch_vlan',
          values: { device: 'switch0', vlan: '3', vid: '100', ports: '2t 6t' },
        },
      },
    ]);
  });
});

describe('VLAN filtering on a bridge', () => {
  it('turns it on like LuCI: VLAN 1 untagged everywhere, interfaces move to br-lan.1', () => {
    const { values, board } = recorded();
    const s = parseVlans(values, board) as DsaVlans;
    expect(enableFilteringChanges(s)).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'network', section: 'cfg030f15', values: { vlan_filtering: '1' } },
      },
      {
        object: 'uci',
        method: 'add',
        params: {
          config: 'network',
          type: 'bridge-vlan',
          values: { device: 'br-lan', vlan: '1', ports: ['eth0:u*', 'eth2:u*', 'eth3:u*'] },
        },
      },
      { object: 'uci', method: 'set', params: { config: 'network', section: 'lan', values: { device: 'br-lan.1' } } },
    ]);
  });

  it('turns it off only when a single VLAN carries every port untagged', () => {
    const one = net(
      sec('dev_lan', 'device', { name: 'br-lan', type: 'bridge', ports: ['lan1', 'lan2'], vlan_filtering: '1' }),
      sec('vlan1', 'bridge-vlan', { device: 'br-lan', vlan: '1', ports: ['lan1:u*', 'lan2:u*'] }),
      sec('lan', 'interface', { device: 'br-lan.1', proto: 'static' }),
    );
    const s = parseVlans(one, {}) as DsaVlans;
    expect(canDisableFiltering(s)).toBe(true);
    expect(disableFilteringChanges(s)).toEqual([
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'vlan1' } },
      { object: 'uci', method: 'delete', params: { config: 'network', section: 'dev_lan', option: 'vlan_filtering' } },
      { object: 'uci', method: 'set', params: { config: 'network', section: 'lan', values: { device: 'br-lan' } } },
    ]);
    expect(canDisableFiltering(parseVlans(dsa, {}) as DsaVlans)).toBe(false);
    expect(() => disableFilteringChanges(parseVlans(dsa, {}) as DsaVlans)).toThrow(
      expect.objectContaining({ code: 'filtering-in-use' }),
    );
  });
});

describe('getVlans', () => {
  it('reads the network config and the board, and the switch features on swconfig routers', async () => {
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.get.network', ok({ values: sw }))
      .override('luci-rpc.getBoardJSON', ok(swBoard))
      .override('luci.getSwconfigFeatures', ok({ vid_option: 'vid' }));
    const s = (await getVlans(conn)) as SwitchVlans;
    expect(s.kind).toBe('swconfig');
    expect(s.vidOption).toBe('vid');
  });

  it('works from the QEMU recording', async () => {
    const s = await getVlans(new FixtureConnection('openwrt-24.10.8'));
    expect(s).toMatchObject({ kind: 'dsa', bridge: 'br-lan', filtering: false });
  });
});
