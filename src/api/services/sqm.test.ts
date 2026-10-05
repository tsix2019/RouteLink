import { FixtureConnection, fail, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import { getSqm, parseSqm, queueChanges, saveSqm, validateQueue, type SqmInput } from './sqm';

const recorded = () =>
  (loadFixture('openwrt-24.10.8', 'uci.get.sqm') as { data: { values: Record<string, UciSection> } }).data.values;

const input: SqmInput = {
  enabled: true,
  interface: 'pppoe-wan',
  download: '95',
  upload: '18.5',
  script: 'piece_of_cake.qos',
  linklayer: 'ethernet',
};

describe('parseSqm', () => {
  it('reads the default queue in Mbit/s, and whether it shapes right now', () => {
    expect(parseSqm(recorded(), ['eth1', 'br-lan'])).toEqual([
      {
        section: 'eth1',
        enabled: false,
        interface: 'eth1',
        download: 85,
        upload: 10,
        script: 'piece_of_cake.qos',
        qdisc: 'cake',
        linklayer: 'none',
        active: false,
      },
    ]);
    // Download shaping runs through an ifb device that sqm creates.
    expect(parseSqm(recorded(), ['eth1', 'ifb4eth1'])[0].active).toBe(true);
  });

  it('reads an overhead for DSL and Ethernet link layers', () => {
    const values = { q: { ...recorded().eth1, '.name': 'q', linklayer: 'atm', overhead: '44' } };
    expect(parseSqm(values, [])[0]).toMatchObject({ linklayer: 'atm', overhead: 44 });
  });
});

describe('validateQueue', () => {
  it.each([
    [input, {}],
    [{ ...input, download: 'x' }, { download: 'rate-invalid' }],
    [{ ...input, upload: '-1' }, { upload: 'rate-invalid' }],
    [{ ...input, download: '0', upload: '0' }, { download: 'rate-required' }],
    [{ ...input, enabled: false, download: '0', upload: '0' }, {}],
    [{ ...input, interface: '' }, { interface: 'required' }],
  ] as const)('%j', (i, errors) => {
    expect(validateQueue(i as SqmInput)).toEqual(errors);
  });
});

describe('queueChanges', () => {
  it('edits the existing queue: kbit/s, cake for the cake scripts, overhead for the link layer', () => {
    const [queue] = parseSqm(recorded(), []);
    expect(queueChanges(input, queue)).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: {
          config: 'sqm',
          section: 'eth1',
          values: {
            enabled: '1',
            interface: 'pppoe-wan',
            download: '95000',
            upload: '18500',
            script: 'piece_of_cake.qos',
            qdisc: 'cake',
            linklayer: 'ethernet',
            overhead: '38',
          },
        },
      },
    ]);
  });

  it('uses fq_codel for the simple scripts and drops the overhead without a link layer', () => {
    const queue = parseSqm({ q: { ...recorded().eth1, '.name': 'q', linklayer: 'atm', overhead: '44' } }, [])[0];
    const changes = queueChanges({ ...input, script: 'simple.qos', linklayer: 'none' }, queue);
    expect((changes[0].params as { values: Record<string, string> }).values).toMatchObject({
      qdisc: 'fq_codel',
      linklayer: 'none',
    });
    expect(changes[1]).toEqual({
      object: 'uci',
      method: 'delete',
      params: { config: 'sqm', section: 'q', option: 'overhead' },
    });
  });

  it('adds a queue when there is none', () => {
    expect(queueChanges(input)).toEqual([
      expect.objectContaining({
        method: 'add',
        params: expect.objectContaining({ config: 'sqm', type: 'queue', name: 'pppoe_wan' }),
      }),
    ]);
  });
});

describe('router calls', () => {
  it('reads queues, qdiscs, devices and the WAN device', async () => {
    const state = await getSqm(new FixtureConnection('openwrt-24.10.8'));
    expect(state.installed).toBe(true);
    expect(state.qdiscs).toEqual(expect.arrayContaining(['cake', 'fq_codel']));
    expect(state.wanDevice).toBe('eth1');
    expect(state.devices).toContain('eth1');
    const none = new FixtureConnection('openwrt-24.10.8').override('uci.get.sqm', fail('NOT_FOUND'));
    expect((await getSqm(none)).installed).toBe(false);
  });

  it('applies, then enables and starts sqm', async () => {
    const conn = new FixtureConnection()
      .override('uci.set', ok({}))
      .override('uci.apply', ok({}))
      .override('file.exec', ok({ code: 0 }));
    const [queue] = parseSqm(recorded(), []);
    await saveSqm(conn, queueChanges(input, queue));
    expect(conn.calls.filter((c) => c.method === 'exec').map((c) => c.params)).toEqual([
      { command: '/etc/init.d/sqm', params: ['enable'] },
      { command: '/etc/init.d/sqm', params: ['start'] },
    ]);
  });
});
