import { FixtureConnection, fail, loadFixture, ok } from '../../../test/fixture-connection';
import type { UciSection } from '../uci';
import {
  adblockAction,
  chooseAdblock,
  getAdblock,
  parseAdblockFast,
  parseAdblockRuntime,
  pickDefaultSource,
  sourceChanges,
  type AdblockState,
} from './adblock';

const fastUci = () =>
  (loadFixture('openwrt-24.10.8', 'uci.get.adblock-fast') as { data: { values: Record<string, UciSection> } }).data
    .values;
const adbUci = () =>
  (loadFixture('openwrt-24.10.8', 'uci.get.adblock') as { data: { values: Record<string, UciSection> } }).data.values;
const fastStatus = () =>
  (loadFixture('openwrt-24.10.8', 'luci.adblock-fast.getInitStatus') as { data: Record<string, unknown> }).data;

const RUNNING = {
  'adblock-fast': {
    version: '1.2.4-r4',
    enabled: true,
    running: true,
    status: 'statusSuccess',
    entries: 213456,
    errors: [],
    warnings: [{ code: 'warningMissingRecommendedPackages', info: 'grep, sed' }],
  },
};

describe('chooseAdblock', () => {
  it('prefers the one that is on, then adblock-fast', () => {
    expect(chooseAdblock({ fast: true, fastEnabled: false, adblock: true, adblockEnabled: true })).toBe('adblock');
    expect(chooseAdblock({ fast: true, fastEnabled: false, adblock: true, adblockEnabled: false })).toBe(
      'adblock-fast',
    );
    expect(chooseAdblock({ fast: false, fastEnabled: false, adblock: true, adblockEnabled: false })).toBe('adblock');
    expect(chooseAdblock({ fast: false, fastEnabled: false, adblock: false, adblockEnabled: false })).toBeNull();
  });
});

describe('adblock-fast', () => {
  it('reads the recorded state: off, with its sources', () => {
    const s = parseAdblockFast(fastUci(), fastStatus());
    expect(s).toMatchObject({ package: 'adblock-fast', enabled: false, status: 'stopped', blocked: 0 });
    expect(s.sources.length).toBeGreaterThan(5);
    expect(s.sources[0]).toMatchObject({ name: expect.any(String), enabled: false, action: 'block' });
    expect(s.sources[0].id).toMatch(/^cfg|^@/);
  });

  it('reads a running status with its count and the first warning', () => {
    const s = parseAdblockFast(fastUci(), RUNNING);
    expect(s).toMatchObject({ enabled: true, status: 'running', blocked: 213456, version: '1.2.4-r4' });
    expect(s.message).toEqual({ code: 'warningMissingRecommendedPackages', info: 'grep, sed' });
  });

  it('turns failures and work in progress into states', () => {
    const at = (status: string, errors: unknown[] = []) =>
      parseAdblockFast(fastUci(), { 'adblock-fast': { ...RUNNING['adblock-fast'], status, errors } }).status;
    expect(at('statusDownloading')).toBe('working');
    expect(at('statusFail', [{ code: 'errorNothingToDo', info: '' }])).toBe('error');
    expect(at('statusPaused')).toBe('paused');
  });

  it('picks a small general list when nothing is selected', () => {
    const s = parseAdblockFast(fastUci(), fastStatus());
    expect(pickDefaultSource(s)?.name).toBe('AdAway - Hosts');
    expect(pickDefaultSource({ ...s, sources: s.sources.map((x, i) => ({ ...x, enabled: i === 2 })) })).toBeNull();
  });

  it('switches sources in uci', () => {
    const s = parseAdblockFast(fastUci(), fastStatus());
    expect(sourceChanges(s, { [s.sources[0].id]: true })).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'adblock-fast', section: s.sources[0].id, values: { enabled: '1' } },
      },
    ]);
  });
});

describe('adblock', () => {
  const runtime = JSON.stringify({
    adblock_status: 'enabled',
    adblock_version: '4.4.2-r4',
    blocked_domains: '154321',
    active_feeds: ['adguard', 'certpl'],
    last_run: '2026-10-05T04:00:12+08:00',
  });
  const feeds = JSON.stringify({
    adguard: { url: 'https://x', size: 'L', descr: 'general' },
    certpl: { url: 'https://y', size: 'L', descr: 'phishing' },
    oisd_small: { url: 'https://z', size: 'M', descr: 'general' },
  });

  it('reads the runtime file and the feed list', () => {
    expect(parseAdblockRuntime(runtime)).toEqual({
      status: 'running',
      blocked: 154321,
      version: '4.4.2-r4',
      lastRun: '2026-10-05T04:00:12+08:00',
    });
    expect(parseAdblockRuntime('{"adblock_status":"error","blocked_domains":"0","last_run":"-"}')).toEqual({
      status: 'error',
      blocked: 0,
    });
    expect(parseAdblockRuntime('not json')).toBeNull();
  });

  it('builds the state from uci, the feeds and the runtime', async () => {
    const global = { ...adbUci().global, adb_enabled: '1', adb_feed: ['adguard', 'certpl', 'retired'] };
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.get.adblock-fast', fail('NOT_FOUND'))
      .override('uci.get.adblock', ok({ values: { ...adbUci(), global } }))
      .override('luci.adblock-fast.getInitStatus', fail('NOT_FOUND'))
      .override('file.read.etc-adblock-adblock-feeds', ok({ data: feeds }));
    const reads: string[] = [];
    Object.assign(conn, {
      cgiRead: async (path: string) => {
        reads.push(path);
        return runtime;
      },
    });
    const s = (await getAdblock(conn)) as AdblockState;
    expect(s).toMatchObject({ package: 'adblock', enabled: true, status: 'running', blocked: 154321 });
    // A selected feed the catalogue no longer has stays selected.
    expect(s.sources.map((x) => [x.id, x.enabled])).toEqual([
      ['adguard', true],
      ['certpl', true],
      ['oisd_small', false],
      ['retired', true],
    ]);
    expect(sourceChanges(s, { oisd_small: true, certpl: false })).toEqual([
      {
        object: 'uci',
        method: 'set',
        params: { config: 'adblock', section: 'global', values: { adb_feed: ['adguard', 'oisd_small', 'retired'] } },
      },
    ]);
    expect(reads).toEqual(['/var/run/adb_runtime.json']);
  });
});

describe('router calls', () => {
  it('reads the recording: adblock-fast, off', async () => {
    const s = await getAdblock(new FixtureConnection('openwrt-24.10.8'));
    expect(s).toMatchObject({ package: 'adblock-fast', both: true, enabled: false });
  });

  it('is empty without either package', async () => {
    const conn = new FixtureConnection('openwrt-24.10.8')
      .override('uci.get.adblock-fast', fail('NOT_FOUND'))
      .override('uci.get.adblock', fail('NOT_FOUND'));
    expect(await getAdblock(conn)).toEqual({ package: null });
  });

  it('starts adblock-fast through its rpcd object, adblock through its init script', async () => {
    const fast = new FixtureConnection().override('luci.adblock-fast.setInitAction', ok({ result: true }));
    await adblockAction(fast, 'adblock-fast', 'on');
    expect(fast.calls.map((c) => (c.params as { action: string }).action)).toEqual(['enable', 'start']);

    const adb = new FixtureConnection()
      .override('uci.set', ok({}))
      .override('uci.apply', ok({}))
      .override('file.exec', ok({ code: 0 }));
    await adblockAction(adb, 'adblock', 'off');
    expect(adb.calls[0].params).toEqual({ config: 'adblock', section: 'global', values: { adb_enabled: '0' } });
    expect(adb.calls.at(-1)!.params).toEqual({ command: '/etc/init.d/adblock', params: ['restart'] });
  });
});
