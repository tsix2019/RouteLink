/**
 * Contract: every service function must work against the demo router, so demo mode can show every
 * screen (design §26). Add each new service function here.
 */
import { createHash } from 'node:crypto';

import { demoInstallDeps } from '../../../features/agent/demoInstall';
import { installAgent } from '../../../features/agent/install';
import { detectCapabilities } from '../../capabilities';
import { NativeError } from '../../http/errors';
import {
  blockClient,
  kickClient,
  removeStaticIp,
  renameClient,
  setStaticIp,
  unblockClient,
  wakeOnLan,
} from '../../services/client-actions';
import {
  agentEvents,
  agentHistory,
  agentLive,
  agentSummary,
  getAgentDevices,
  getAgentStatus,
  type History,
} from '../../services/agent';
import { getClients } from '../../services/clients';
import { kernelLog, systemLog } from '../../services/logs';
import { getDeviceCounters, getInterfaces, pickWan, reconnectInterface } from '../../services/network';
import { detectPackageEnv, removePackages } from '../../services/packages';
import { listServices, serviceAction } from '../../services/services';
import { getSystem, getTemperature, loadRatio, reboot } from '../../services/system';
import { getRadios, networkChanges, radioChanges, scan } from '../../services/wireless';
import { stageAndApply } from '../../uci';
import { DemoConnection } from './connection';

const fast = { sleep: async () => {} };

function demo() {
  let now = 1_800_000_000_000;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  return { conn: new DemoConnection(2026, clock.now), clock };
}

describe('demo router: read services', () => {
  it('system, temperature and load', async () => {
    const { conn } = demo();
    const s = await getSystem(conn);
    expect(s.model).toBe('OpenWrt One');
    expect(s.cpuCores).toBe(4);
    expect(loadRatio(s)).toBeGreaterThan(0);
    expect(await getTemperature(conn)).toBeGreaterThan(40);
  });

  it('every capability is available', async () => {
    const caps = await detectCapabilities(demo().conn);
    expect(Object.values(caps).every((c) => c.status === 'ok')).toBe(true);
  });

  it('interfaces with a PPPoE WAN and live counters', async () => {
    const { conn, clock } = demo();
    const ifs = await getInterfaces(conn);
    expect(pickWan(ifs)).toMatchObject({ name: 'wan', proto: 'pppoe', gateway: '203.0.113.1' });
    const before = (await getDeviceCounters(conn))['pppoe-wan'];
    clock.advance(2_000);
    const after = (await getDeviceCounters(conn))['pppoe-wan'];
    expect(after.rx).toBeGreaterThan(before.rx);
  });

  it('clients: wifi, wired, offline, static and blocked', async () => {
    const clients = await getClients(demo().conn);
    expect(clients).toHaveLength(15);
    expect(clients.filter((c) => c.connection === 'wifi' && c.online).length).toBeGreaterThanOrEqual(8);
    expect(clients.filter((c) => !c.online)).toHaveLength(2);
    expect(clients.find((c) => c.name === 'NAS')).toMatchObject({ isStatic: true, connection: 'wired' });
    expect(clients.find((c) => c.name === 'Smart-Plug')).toMatchObject({ isBlocked: true });
    expect(clients.find((c) => c.name === 'iPhone-16-Pro')?.vendor).toBe('Apple');
  });

  it('radios, scan, services and logs', async () => {
    const { conn } = demo();
    const radios = await getRadios(conn);
    expect(radios.map((r) => r.band)).toEqual(['2.4G', '5G']);
    expect(radios[1].networks[0]).toMatchObject({ ssid: 'RouteLink-5G', ifname: 'phy1-ap0', up: true });
    expect((await scan(conn, 'phy0-ap0')).length).toBeGreaterThan(3);
    expect((await listServices(conn)).length).toBeGreaterThan(10);
    expect((await systemLog(conn)).length).toBe(120);
    expect((await kernelLog(conn)).length).toBeGreaterThan(5);
  });
});

describe('demo router: writes change what reads return', () => {
  it('rename, static IP, block and unblock', async () => {
    const { conn } = demo();
    const find = async (mac: string) => (await getClients(conn)).find((c) => c.mac === mac)!;
    const tv = (await getClients(conn)).find((c) => c.name === 'Living-Room-TV')!;

    expect(await renameClient(conn, tv, '客厅电视', fast)).toEqual({ status: 'confirmed' });
    expect((await find(tv.mac)).name).toBe('客厅电视');

    await setStaticIp(conn, await find(tv.mac), '192.168.8.200', await getClients(conn), fast);
    expect(await find(tv.mac)).toMatchObject({ isStatic: true, staticIp: '192.168.8.200' });

    await blockClient(conn, await find(tv.mac), fast);
    expect((await find(tv.mac)).isBlocked).toBe(true);
    await unblockClient(conn, await find(tv.mac), fast);
    expect((await find(tv.mac)).isBlocked).toBe(false);

    await removeStaticIp(conn, await find(tv.mac), fast);
    expect((await find(tv.mac)).isStatic).toBe(false);
  });

  it('kick removes the station; wake brings an offline device back', async () => {
    const { conn } = demo();
    const phone = (await getClients(conn)).find((c) => c.name === 'Pixel-9')!;
    await kickClient(conn, phone, 1);
    expect((await getClients(conn)).find((c) => c.mac === phone.mac)?.online).toBe(false);

    const laptop = (await getClients(conn)).find((c) => c.name === 'ThinkPad')!;
    expect(laptop.online).toBe(false);
    await wakeOnLan(conn, laptop.mac, { routerSide: true });
    expect((await getClients(conn)).find((c) => c.mac === laptop.mac)?.online).toBe(true);
  });

  it('wireless and service edits', async () => {
    const { conn } = demo();
    const [radio24] = await getRadios(conn);
    await stageAndApply(conn, radioChanges(radio24, { channel: '11' }), { mode: 'rollback', ...fast });
    await stageAndApply(conn, networkChanges(radio24.networks[0], { ssid: 'Home' }), { mode: 'direct', ...fast });
    const [after] = await getRadios(conn);
    expect(after.channel).toBe('11');
    expect(after.networks[0].ssid).toBe('Home');

    await serviceAction(conn, 'cron', 'stop');
    expect((await listServices(conn)).find((s) => s.name === 'cron')?.running).toBe(false);
    await reconnectInterface(conn, 'wan');
  });

  it('reboot makes the router unreachable for a while', async () => {
    const { conn, clock } = demo();
    const before = (await getSystem(conn)).uptimeSec;
    await reboot(conn);
    await expect(getSystem(conn)).rejects.toBeInstanceOf(NativeError);
    expect(await conn.ping()).toBe(false);
    clock.advance(10_000);
    expect(await conn.ping()).toBe(true);
    expect((await getSystem(conn)).uptimeSec).toBeLessThan(before);
  });
});

describe('demo router: the routelink plugin', () => {
  const { conn } = demo();
  const now = Math.floor(1_800_000_000_000 / 1000);
  const midnight = Math.floor((now + 8 * 3600) / 86400) * 86400 - 8 * 3600;
  const sum = (h: History) => h.points.reduce((s, p) => [s[0] + (p.rx ?? 0), s[1] + (p.tx ?? 0)], [0, 0]);
  /** Equal up to rounding: the demo rounds per point in a history and per device in a summary. */
  const expectSameTotals = (s: { rx: number; tx: number }, h: History) => {
    const [rx, tx] = sum(h);
    const slack = h.points.length + 16;
    expect(Math.abs(s.rx - rx)).toBeLessThanOrEqual(slack);
    expect(Math.abs(s.tx - tx)).toBeLessThanOrEqual(slack);
  };

  it('is installed and running', async () => {
    await expect(getAgentStatus(conn)).resolves.toMatchObject({
      state: 'ok',
      info: { api: 1, zonename: 'Asia/Shanghai' },
    });
  });

  it('knows every device, with today’s usage and current rates', async () => {
    const devices = await getAgentDevices(conn);
    expect(devices).toHaveLength(15);
    expect(devices.filter((d) => d.today.rx > 0).length).toBeGreaterThan(10);
    expect(devices.filter((d) => !d.online).map((d) => d.hostname)).toEqual(
      expect.arrayContaining(['ThinkPad', 'iPad']),
    );
  });

  it('splits the live WAN rate across the devices', async () => {
    const live = await agentLive(conn);
    const total = live.devices.reduce((s, d) => s + d.rxBps, 0);
    expect(total).toBeGreaterThan(0);
    expect(Math.abs(total * 1.03 - live.wan.rxBps) / live.wan.rxBps).toBeLessThan(0.01);
    const order = live.devices.map((d) => d.rxBps + d.txBps);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });

  it.each([
    ['today, by the minute', midnight, now],
    ['the last 7 days, by the hour', now - 7 * 86400, now],
    ['100 days back, by the day', now - 100 * 86400, now - 95 * 86400],
  ])('summary totals equal the history: %s', async (_name, start, end) => {
    const s = await agentSummary(conn, { start, end, limit: 500 });
    expectSameTotals(s, await agentHistory(conn, { start, end }));
    expect(s.wanRx).toBeGreaterThan(s.rx);
  });

  it('keeps hour-of-day filters consistent too', async () => {
    const q = { start: now - 7 * 86400, end: now, hoursMask: (1 << 20) | (1 << 21) | (1 << 22) };
    const s = await agentSummary(conn, { ...q, limit: 500 });
    expectSameTotals(s, await agentHistory(conn, q));
    const all = await agentSummary(conn, { start: q.start, end: q.end, limit: 500 });
    expect(s.rx).toBeLessThan(all.rx / 3);
  });

  it('has no data before the plugin was installed', async () => {
    const h = await agentHistory(conn, { start: now - 200 * 86400, end: now - 190 * 86400 });
    expect(h.tier).toBe('day');
    expect(h.points.every((p) => p.rx === null)).toBe(true);
  });

  it('per-device history, events and LAN traffic', async () => {
    const devices = await getAgentDevices(conn);
    const laptop = devices.find((d) => d.hostname === 'MacBook-Air')!;
    const h = await agentHistory(conn, { mac: laptop.mac, start: now - 86400, end: now });
    expect(sum(h)[0]).toBeGreaterThan(0);
    const e = await agentEvents(conn, { start: now - 3 * 86400, end: now, mac: laptop.mac });
    expect(e.events.map((x) => x.type)).toEqual(expect.arrayContaining(['device_online', 'device_offline']));
    expect(e.events.map((x) => x.ts)).toEqual([...e.events.map((x) => x.ts)].sort((a, b) => b - a));
    const lan = await agentSummary(conn, { start: now - 86400, end: now, cls: 'lan' });
    expect(lan.devices[0].mac).toBe(devices.find((d) => d.hostname === 'NAS')!.mac);
  });

  it('can be removed and installed again with the one-tap flow', async () => {
    const fresh = new DemoConnection(2026, () => 1_800_000_000_000, 0);
    const env = await detectPackageEnv(fresh);
    expect(env).toMatchObject({ release: '24.10', arch: 'aarch64_cortex-a53', manager: 'opkg' });
    if ('unsupported' in env) return;
    await removePackages(fresh, env, ['luci-i18n-routelink-zh-cn', 'luci-app-routelink', 'routelinkd']);
    await expect(getAgentStatus(fresh)).resolves.toEqual({ state: 'not-installed' });
    const sha256 = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const result = await installAgent({
      conn: fresh,
      ...demoInstallDeps(sha256, 0),
      sha256,
      onStep: () => undefined,
      sleep: async () => undefined,
    });
    expect(result).toEqual({ step: 'done', version: '0.1.0' });
  });
});
