/**
 * Contract for P2 (network groups and Wi-Fi tools): the demo router, its demo AP and the plugin's wireless
 * methods must serve every screen. Add each new service function here.
 */
import { checkNetwork, parseWifiFeatures } from '../../../features/wifi-tools/security';
import { getDeviceMarks, setDeviceMarks } from '../../../features/wifi-tools/trust';
import { getApStations, getGroupClients } from '../../group';
import { agentEvents, getAgentDevices, getAgentStatus } from '../../services/agent';
import { agentSignal, agentStations, agentSurvey } from '../../services/agent-wifi';
import { kickClient } from '../../services/client-actions';
import { getRadioCapabilities, getRadios } from '../../services/wireless';
import { DEMO_AP_ID, DEMO_AP_NAME, DEMO_ROUTER_ID, DemoApConnection, DemoConnection } from './connection';

const NOW = 1_800_000_000_000;

function demo(at = NOW) {
  let now = at;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const conn = new DemoConnection(2026, clock.now, 0);
  return { conn, ap: new DemoApConnection(conn), clock };
}

const gateway = { id: DEMO_ROUTER_ID, name: 'RouteLink Demo' };
const member = (ap: DemoApConnection) => [{ id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: ap }];

describe('demo network group', () => {
  it('reports the plugin roles and the wifi module on both routers', async () => {
    const { conn, ap } = demo();
    await expect(getAgentStatus(conn)).resolves.toMatchObject({
      state: 'ok',
      info: { roles: ['gateway', 'ap'], capabilities: ['traffic', 'wifi'], retention: { signalMinuteDays: 7 } },
    });
    await expect(getAgentStatus(ap)).resolves.toMatchObject({
      state: 'ok',
      info: { roles: ['ap'], modules: ['wifi'] },
    });
  });

  it('splits the Wi-Fi devices between the gateway and the AP', async () => {
    const { conn, ap } = demo();
    const g = await agentStations(conn);
    const a = await agentStations(ap);
    expect(g.interfaces.map((i) => i.ssid)).toEqual(['RouteLink', 'RouteLink-5G']);
    expect(a.interfaces.map((i) => i.bssid)).toEqual(['94:83:C4:00:01:01', '94:83:C4:00:01:02']);
    const macs = new Set(g.stations.map((s) => s.mac));
    expect(a.stations.length).toBeGreaterThanOrEqual(3);
    expect(a.stations.some((s) => macs.has(s.mac))).toBe(false);
    for (const s of [...g.stations, ...a.stations]) {
      expect(s.signal).toBeLessThan(-30);
      expect(s.signal).toBeGreaterThan(-90);
      expect(s.txRetries).toBeGreaterThanOrEqual(0);
    }
    expect((await getApStations(ap)).source).toBe('plugin');
  });

  it('merges the group: AP clients carry their AP, everything else comes from the gateway', async () => {
    const { conn, ap } = demo();
    const { clients, offline } = await getGroupClients(conn, gateway, member(ap));
    expect(offline).toEqual([]);
    expect(clients).toHaveLength(15);
    expect(clients.filter((c) => c.connection === 'wifi' && c.online).length).toBeGreaterThanOrEqual(8);
    const tv = clients.find((c) => c.name === 'Living-Room-TV')!;
    expect(tv.ap).toMatchObject({ routerId: DEMO_AP_ID, band: '5G', ssid: 'RouteLink-5G' });
    expect(tv.ipv4).toBe('192.168.8.106');
    expect(clients.find((c) => c.name === 'Pixel-9')!.ap).toMatchObject({ routerId: DEMO_ROUTER_ID });
  });

  it('marks AP clients unknown while the AP is offline', async () => {
    const { conn, ap } = demo();
    await getGroupClients(conn, gateway, member(ap));
    const { clients, offline } = await getGroupClients(conn, gateway, [
      { id: DEMO_AP_ID, name: DEMO_AP_NAME, connection: null },
    ]);
    expect(offline.map((m) => m.id)).toEqual([DEMO_AP_ID]);
    // The merge remembers where the TV was last seen within the app session (per gateway).
    expect(clients.find((c) => c.name === 'Living-Room-TV')).toMatchObject({ ap: { stale: true }, wifi: undefined });
  });

  it('kicks a client on the AP it is associated with', async () => {
    const { conn, ap } = demo();
    const echo = (await getGroupClients(conn, gateway, member(ap))).clients.find((c) => c.name === 'Echo-Dot')!;
    await kickClient(ap, echo, 1);
    expect((await agentStations(ap)).stations.map((s) => s.mac)).not.toContain(echo.mac);
  });

  it('serves the AP radios, capabilities and features', async () => {
    const { ap } = demo();
    const radios = await getRadios(ap);
    expect(radios.map((r) => [r.band, r.channel])).toEqual([
      ['2.4G', '1'],
      ['5G', '36'],
    ]);
    expect(radios[0].networks[0]).toMatchObject({ ssid: 'RouteLink', encryption: 'psk2', wps: true });
    expect((await getRadioCapabilities(ap, 'radio1')).channels.length).toBeGreaterThan(10);
    const features = parseWifiFeatures(await ap.call('luci', 'getFeatures'));
    expect(features).toEqual({ sae: true });
    const report = checkNetwork(radios[0].networks[0], features);
    expect(report.level).toBe('medium');
    expect(report.findings.map((f) => f.kind)).toEqual(['password', 'wps', 'mfp-off']);
  });
});

describe('demo plugin: signal and survey', () => {
  const now = NOW / 1000;

  it('gives minute history for a day and second points for the last minutes', async () => {
    const { ap } = demo();
    const tv = (await agentStations(ap)).stations[0];
    const day = await agentSignal(ap, { mac: tv.mac, start: now - 86_400, end: now, maxPoints: 300 });
    expect(day.tier).toBe('minute');
    expect(day.points.length).toBeLessThanOrEqual(300);
    expect(day.points.filter((p) => p.signal !== null).length).toBeGreaterThan(100);
    const live = await agentSignal(ap, { mac: tv.mac, start: now - 300, end: now });
    expect(live).toMatchObject({ tier: 'live', step: 1 });
    const month = await agentSignal(ap, { mac: tv.mac, start: now - 60 * 86_400, end: now });
    expect(month.tier).toBe('hour');
    expect(month.points[0].signal).toBeNull(); // older than the 30-day retention
  });

  it('has no history for a station the router never saw', async () => {
    const { conn, ap } = demo();
    const tv = (await agentStations(ap)).stations[0];
    const h = await agentSignal(conn, { mac: tv.mac, start: now - 3600, end: now });
    expect(h.points).toEqual([]);
  });

  it('reports channel load for the current channels and the scanned ones', async () => {
    const { ap } = demo();
    const s = await agentSurvey(ap);
    expect(s.radios.map((r) => r.channel)).toEqual([1, 36]);
    for (const r of s.radios) expect(r.busyPct).toEqual(expect.any(Number));
    expect(s.channels.length).toBeGreaterThan(5);
  });

  it('records the iPhone roaming to the AP in the morning', async () => {
    const { conn, ap } = demo();
    const iphone = (await getAgentDevices(conn)).find((d) => d.hostname === 'iPhone-16-Pro')!;
    const q = { start: now - 2 * 86_400, end: now, mac: iphone.mac };
    const onAp = await agentEvents(ap, q);
    const onGateway = await agentEvents(conn, q);
    expect(onAp.events.map((e) => e.type)).toEqual(expect.arrayContaining(['wifi_connect', 'wifi_disconnect']));
    expect(onGateway.events.filter((e) => e.type === 'wifi_disconnect').length).toBeGreaterThanOrEqual(2);
    expect(onAp.events.every((e) => (e.value ?? 0) > 2400)).toBe(true);
  });
});

describe('demo trust list', () => {
  it('lives in the plugin UCI and shows in its device list', async () => {
    const { conn } = demo();
    const marks = await getDeviceMarks(conn);
    expect(marks.filter((m) => m.trusted)).toHaveLength(5);
    const pixel = (await getAgentDevices(conn)).find((d) => d.hostname === 'Pixel-9')!;
    expect(pixel.trusted).toBe(false);
    await setDeviceMarks(conn, [{ mac: pixel.mac, trusted: true }]);
    expect((await getAgentDevices(conn)).find((d) => d.mac === pixel.mac)).toMatchObject({ trusted: true });
    expect((await getAgentDevices(conn)).find((d) => d.hostname === 'NAS')).toMatchObject({
      trusted: true,
      watch: true,
    });
  });
});
