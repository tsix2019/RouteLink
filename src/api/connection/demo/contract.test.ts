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
import { createGuestChanges, deleteGuestChanges, getGuestState, guestWifiChanges } from '../../services/guest';
import { getConnections, groupBySource, ReverseDns } from '../../services/conntrack';
import {
  applyFirewallChanges,
  deleteSectionChanges,
  getFirewall,
  portForwardChanges,
  setEnabledChanges,
} from '../../services/firewall';
import { parseCrontab, readCrontab, writeCrontab } from '../../services/cron';
import { getLeds, ledChanges } from '../../services/leds';
import { kernelLog, systemLog } from '../../services/logs';
import { getDeviceCounters, getInterfaces, pickWan, reconnectInterface } from '../../services/network';
import { installPackages, listAvailable, listInstalled, searchPackages } from '../../services/package-list';
import { detectPackageEnv, removePackages } from '../../services/packages';
import { getParental, saveSchedule } from '../../services/parental';
import { listProcesses, signalProcess } from '../../services/processes';
import {
  applyVlanChanges,
  canDisableFiltering,
  disableFilteringChanges,
  enableFilteringChanges,
  getVlans,
  validateVlans,
  vlanChanges,
  type DsaVlans,
  type Vlan,
} from '../../services/vlan';
import { getWifiSchedules, saveWifiSchedules } from '../../services/wifi-schedule';
import { deleteStaticRoute, getRoutes, saveStaticRoute } from '../../services/routes';
import { listServices, serviceAction } from '../../services/services';
import { getSystem, getTemperature, loadRatio, reboot } from '../../services/system';
import {
  getTimeSettings,
  getTimezones,
  setAdminPassword,
  syncRouterClock,
  timezoneChanges,
} from '../../services/system-settings';
import { getWireGuard, peerConnected } from '../../services/wireguard';
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

describe('demo router: system and network pages (M2)', () => {
  it('processes: listed, and a stopped one goes away', async () => {
    const { conn } = demo();
    const ps = await listProcesses(conn);
    expect(ps.length).toBeGreaterThan(15);
    const ntpd = ps.find((p) => p.name === 'ntpd')!;
    await signalProcess(conn, ntpd.pid, 'TERM');
    expect((await listProcesses(conn)).some((p) => p.pid === ntpd.pid)).toBe(false);
    await expect(signalProcess(conn, 99_999, 'TERM')).rejects.toMatchObject({ code: 'kill-failed' });
  });

  it('scheduled tasks: read, add one, read it back', async () => {
    const { conn } = demo();
    const tab = await readCrontab(conn);
    // Two of the user's own; the Wi-Fi schedule and the parental-control flush are the app's.
    expect(tab.lines.filter((l) => l.kind === 'entry').map((l) => l.kind === 'entry' && l.managed)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    const [added] = parseCrontab('0 3 * * * /etc/init.d/dnsmasq restart');
    await writeCrontab(conn, [...tab.lines, added], tab.original);
    expect((await readCrontab(conn)).lines.filter((l) => l.kind === 'entry')).toHaveLength(6);
    await expect(writeCrontab(conn, tab.lines, tab.original)).rejects.toMatchObject({ code: 'cron-changed' });
  });

  it('LEDs: switching one off changes its state', async () => {
    const { conn } = demo();
    const leds = await getLeds(conn);
    expect(leds.find((l) => l.sysfs === 'green:wan')).toMatchObject({ trigger: 'netdev', dev: 'pppoe-wan' });
    const status = leds.find((l) => l.sysfs === 'white:status')!;
    expect(status.on).toBe(true);
    await stageAndApply(conn, ledChanges(status, { trigger: 'none', on: false }), { mode: 'direct', ...fast });
    expect((await getLeds(conn)).find((l) => l.sysfs === 'white:status')).toMatchObject({ on: false, trigger: 'none' });
  });

  it('time zone, clock and password', async () => {
    const { conn, clock } = demo();
    const phone = Math.floor(clock.now() / 1000);
    const t = await getTimeSettings(conn, phone);
    expect(t).toMatchObject({ zonename: 'Asia/Shanghai', offsetSec: 0, ntp: true });
    const zones = await getTimezones(conn);
    const tokyo = zones.find((z) => z.zonename === 'Asia/Tokyo')!;
    await stageAndApply(conn, timezoneChanges(t.section, tokyo), { mode: 'direct', ...fast });
    expect((await getTimeSettings(conn, phone)).zonename).toBe('Asia/Tokyo');
    await syncRouterClock(conn, phone + 60);
    expect((await getTimeSettings(conn, phone)).offsetSec).toBe(60);
    await setAdminPassword(conn, 'root', 'correct horse');
  });

  it('connections: grouped by device, with names for remote addresses', async () => {
    const { conn } = demo();
    const groups = groupBySource(await getConnections(conn));
    expect(groups.length).toBeGreaterThan(10);
    expect(groups[0].address).toBe('192.168.8.106'); // the TV streaming
    const remotes = [...new Set(groups.flatMap((g) => g.connections.map((c) => c.dst)))];
    const names = await new ReverseDns().resolve(conn, remotes);
    expect(names['45.57.90.1']).toContain('nflxvideo.net');
    expect(Object.keys(names).length).toBeLessThan(remotes.length);
  });

  it('firewall: zones, a port forward and the app’s block rule; forwards can be added, switched off and removed', async () => {
    const { conn } = demo();
    const fw = await getFirewall(conn);
    expect(fw.zones.map((z) => [z.name, z.masq])).toEqual([
      ['lan', false],
      ['wan', true],
      ['vpn', false],
    ]);
    expect(fw.forwards.map((f) => f.name)).toEqual(['NAS-HTTPS']);
    // The block rule and the two halves of the school-night schedule.
    expect(fw.rules.filter((r) => r.managed)).toHaveLength(3);

    const input = {
      name: 'Camera',
      protocols: ['tcp' as const],
      srcZone: 'wan',
      externalPort: '8554',
      destZone: 'lan',
      internalIp: '192.168.8.109',
      internalPort: '554',
    };
    await applyFirewallChanges(conn, portForwardChanges(input), fast);
    const camera = (await getFirewall(conn)).forwards.find((f) => f.name === 'Camera')!;
    await applyFirewallChanges(conn, setEnabledChanges(camera.section, false), fast);
    expect((await getFirewall(conn)).forwards.find((f) => f.name === 'Camera')?.enabled).toBe(false);
    await applyFirewallChanges(conn, deleteSectionChanges(camera.section), fast);
    expect((await getFirewall(conn)).forwards).toHaveLength(1);
  });

  it('WireGuard: one tunnel, one peer connected', async () => {
    const { conn, clock } = demo();
    const [wg0] = await getWireGuard(conn);
    expect(wg0).toMatchObject({ name: 'wg0', listenPort: 51820 });
    const now = Math.floor(clock.now() / 1000);
    expect(wg0.peers.map((p) => [p.name, peerConnected(p, now)])).toEqual([
      ['iPhone (mobile data)', true],
      ['Office laptop', false],
    ]);
  });

  it('packages: listed, searched, installed by name and removed', async () => {
    const { conn } = demo();
    const env = await detectPackageEnv(conn);
    if ('unsupported' in env) throw new Error(env.unsupported);
    const installed = await listInstalled(conn, env);
    expect(installed.find((p) => p.name === 'luci-base')).toMatchObject({ auto: true });
    expect(installed.some((p) => p.name === 'routelinkd')).toBe(true);
    expect(searchPackages(await listAvailable(conn, env), 'adblock').map((p) => p.name)).toEqual([
      'adblock',
      'luci-app-adblock',
    ]);
    expect((await installPackages(conn, env, ['adblock', 'luci-app-adblock'])).ok).toBe(true);
    expect((await listInstalled(conn, env)).some((p) => p.name === 'luci-app-adblock')).toBe(true);
    await removePackages(conn, env, ['luci-app-adblock']);
    expect((await listInstalled(conn, env)).some((p) => p.name === 'luci-app-adblock')).toBe(false);
    expect((await installPackages(conn, env, ['no-such-thing'])).ok).toBe(false);
  });

  it('guest network: created on both radios, switched off and removed', async () => {
    const { conn } = demo();
    const before = await getGuestState(conn);
    expect(before.support).toEqual({ status: 'ok', wanZone: 'wan' });
    expect(before.guest).toBeNull();
    expect(before.freeAddress).toBe('192.168.3.1');
    const input = {
      ssid: 'RouteLink-Guest',
      encryption: 'sae-mixed' as const,
      key: 'welcome-2026',
      radios: before.radios.map((r) => r.name),
      ipaddr: before.freeAddress,
      isolate: true,
    };
    await stageAndApply(conn, createGuestChanges(input, { style: before.style, wanZone: 'wan' }), {
      mode: 'rollback',
      ...fast,
    });
    const created = await getGuestState(conn);
    expect(created.guest?.wifi.map((w) => w.ssid)).toEqual(['RouteLink-Guest', 'RouteLink-Guest']);
    await stageAndApply(conn, guestWifiChanges(created.guest!, false), { mode: 'rollback', ...fast });
    expect((await getGuestState(conn)).guest?.wifi.every((w) => w.disabled)).toBe(true);
    await stageAndApply(conn, deleteGuestChanges(created.configs), { mode: 'rollback', ...fast });
    expect((await getGuestState(conn)).guest).toBeNull();
  });

  it('routes: the static route is installed; new ones appear and can be deleted', async () => {
    const { conn } = demo();
    const r = await getRoutes(conn);
    expect(r.statics).toHaveLength(1);
    expect(r.kernel.find((k) => k.target === '10.10.0.0/16')).toMatchObject({ via: '192.168.8.2', proto: 'static' });
    expect(r.kernel.some((k) => k.family === 6 && k.target === 'default')).toBe(true);

    const input = {
      family: 4 as const,
      interface: 'lan',
      target: '172.20.0.0/16',
      gateway: '192.168.8.3',
      metric: '',
      table: '',
    };
    expect((await saveStaticRoute(conn, input, undefined, fast)).status).toBe('confirmed');
    const after = await getRoutes(conn);
    expect(after.kernel.find((k) => k.target === '172.20.0.0/16')).toMatchObject({ dev: 'br-lan' });
    await deleteStaticRoute(
      conn,
      after.statics.find((s) => s.target === '172.20.0.0/16')!,
      fast,
    );
    expect((await getRoutes(conn)).statics).toHaveLength(1);
  });
});

describe('demo router: M3 router features', () => {
  it('parental control: the school-night schedule, changed and removed', async () => {
    const { conn } = demo();
    const switchMac = (await getClients(conn)).find((c) => c.hostname === 'Nintendo-Switch')!.mac;
    const state = await getParental(conn);
    expect(state.schedules.get(switchMac)).toMatchObject({
      enabled: true,
      periods: [{ days: [0, 1, 2, 3, 4], from: '21:30', to: '07:00' }],
    });
    const weekend = [{ days: [6 as const], from: '10:00', to: '12:00' }];
    expect((await saveSchedule(conn, switchMac, weekend, true, fast)).status).toBe('confirmed');
    const changed = await getParental(conn);
    expect(changed.schedules.get(switchMac)?.periods).toEqual(weekend);
    expect(changed.crontab.original).toContain('0 10 * * 6 ');
    expect(changed.crontab.original).not.toContain('30 21 ');
    await saveSchedule(conn, switchMac, [], true, fast);
    const removed = await getParental(conn);
    expect(removed.schedules.size).toBe(0);
    expect(removed.crontab.original).not.toContain('RouteLink: schedule');
  });

  it('Wi-Fi schedule: school nights for all radios; another one added, then all removed', async () => {
    const { conn } = demo();
    const before = await getWifiSchedules(conn);
    expect(before.schedules).toEqual([{ radios: 'all', days: [0, 1, 2, 3, 4], off: '23:30', on: '07:00' }]);
    const lunch = { radios: ['radio1'], days: [6 as const], off: '12:00', on: '13:00' };
    await saveWifiSchedules(conn, [...before.schedules, lunch], before.crontab);
    const after = await getWifiSchedules(conn);
    expect(after.schedules).toHaveLength(2);
    await saveWifiSchedules(conn, [], after.crontab);
    const cleared = await getWifiSchedules(conn);
    expect(cleared.schedules).toEqual([]);
    // The parental-control entry is not the Wi-Fi schedule's to remove.
    expect(cleared.crontab.original).toContain('# RouteLink: schedule ');
  });
});

describe('demo router: VLANs', () => {
  it('filtering switched on, a VLAN added to the LAN port and removed, filtering off again', async () => {
    const { conn } = demo();
    const before = (await getVlans(conn)) as DsaVlans;
    expect(before).toMatchObject({ kind: 'dsa', bridge: 'br-lan', filtering: false, bridgeUsers: ['lan'] });
    expect(before.ports.map((p) => p.id)).toEqual(['eth1']);
    await applyVlanChanges(conn, enableFilteringChanges(before), fast);
    const on = (await getVlans(conn)) as DsaVlans;
    expect(on.filtering).toBe(true);
    expect(on.vlans.map((v) => [v.id, v.usedBy])).toEqual([[1, ['lan']]]);
    const iot: Vlan = { id: 20, members: { eth1: { mode: 'tagged', pvid: false } }, usedBy: [] };
    expect(validateVlans(on, [...on.vlans, iot])).toEqual([]);
    await applyVlanChanges(conn, vlanChanges(on, [...on.vlans, iot]), fast);
    const two = (await getVlans(conn)) as DsaVlans;
    expect(two.vlans.map((v) => v.id)).toEqual([1, 20]);
    expect(canDisableFiltering(two)).toBe(false);
    await applyVlanChanges(conn, vlanChanges(two, two.vlans.slice(0, 1)), fast);
    const one = (await getVlans(conn)) as DsaVlans;
    await applyVlanChanges(conn, disableFilteringChanges(one), fast);
    expect(await getVlans(conn)).toMatchObject({ filtering: false, vlans: [], bridgeUsers: ['lan'] });
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
