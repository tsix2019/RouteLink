import { UbusError } from '../../ubus/errors';
import { DEMO_CAPABILITIES, eventsOf, type Ev } from './agent';
import { diagCommands } from './diag';
import { uciHandlers, type Handler } from './handlers';
import { type Ctx } from './presence';
import type { DemoState } from './state';
import {
  DEMO_AP_NAME,
  IFNAMES,
  SIGNAL_RETENTION,
  isStationOf,
  signalAt,
  wifiAgentHandlers,
  wifiEvents,
  wirelessHandlers,
  type RadioName,
} from './wifi';

/**
 * The demo access point (P2): a dumb AP on the gateway's LAN with the plugin in the AP role. It answers
 * what the app asks of a group member: system info, Wi-Fi status and config, iwinfo, and the plugin's
 * wireless methods.
 */

const ctxOf = (state: DemoState, nowMs: number): Ctx => ({ state, now: Math.floor(nowMs / 1000) });
const uptime = (state: DemoState, nowMs: number) => Math.floor((nowMs - state.ap.bootTime) / 1000);

function requireInstalled(state: DemoState) {
  if (!state.agent.installed) throw new UbusError('PERMISSION_DENIED', 'routelink');
}

const apEvents = eventsOf((ctx: Ctx, start: number, end: number): Ev[] => {
  const boot = Math.floor(ctx.state.ap.bootTime / 1000) + 38;
  const list: Ev[] = [...wifiEvents(ctx, 'ap', start, end)];
  if (boot >= start && boot < end) list.push({ ts: boot, type: 'daemon_start' });
  return list.sort((a, b) => b.ts - a.ts);
});

export const apHandlers: Record<string, Handler> = {
  'session.access': () => ({ access: true }),
  'system.board': () => ({
    kernel: '6.6.104',
    hostname: 'RouteLink-Demo-AP',
    system: 'ARMv8 Processor rev 4',
    model: 'Xiaomi Mi Router AX3000T',
    board_name: 'xiaomi,mi-router-ax3000t',
    rootfs_type: 'squashfs',
    release: {
      distribution: 'OpenWrt',
      version: '24.10.8',
      revision: 'r29233-443ec4032a',
      target: 'mediatek/filogic',
      description: 'OpenWrt 24.10.8 r29233-443ec4032a',
    },
  }),
  'system.info': (s, _p, now) => ({
    localtime: Math.floor(now / 1000) + 8 * 3600,
    uptime: uptime(s, now),
    load: [0.08, 0.06, 0.05].map((l) => Math.round(l * 65536)),
    memory: {
      total: 257_000_000,
      free: 120_000_000,
      shared: 1_000_000,
      buffered: 0,
      available: 150_000_000,
      cached: 30_000_000,
    },
    root: { total: 46_080, free: 39_936, used: 6_144, avail: 39_936 },
    tmp: { total: 125_440, free: 124_928, used: 512, avail: 124_928 },
    swap: { total: 0, free: 0 },
  }),
  ...wirelessHandlers('ap'),
  'file.exec': (s, p, now) => {
    const run = diagCommands('ap')[String(p.command)];
    if (!run) throw new UbusError('PERMISSION_DENIED', 'file.exec');
    return run(s, (p.params as string[] | undefined) ?? [], now);
  },
  ...uciHandlers((s) => s.ap.uci),
  ...wifiAgentHandlers('ap'),
  'routelink.info': (s, _p, nowMs) => {
    requireInstalled(s);
    const now = Math.floor(nowMs / 1000);
    return {
      version: '1.0.0',
      api: 1,
      roles: ['ap'],
      modules: ['wifi'],
      capabilities: DEMO_CAPABILITIES,
      offload: 'none',
      offload_warning: false,
      nlbwmon_running: false,
      conntrack_accounting: false,
      time_synced: true,
      zonename: 'Asia/Shanghai',
      data_dir: '/etc/routelink',
      storage_used: 412_544,
      storage_limit: 8_388_608,
      commit_interval: 600,
      last_commit: now - 240,
      sample_interval: 10,
      live_interval: 1,
      live_until: 0,
      started: Math.floor(s.ap.bootTime / 1000) + 38,
      events_lost: 0,
      retention: { minute_hours: 48, hour_days: 90, day_days: 730, event_days: 90, ...SIGNAL_RETENTION },
    };
  },
  /** On an AP the device table holds its stations: no addresses or traffic, but where and how loud. */
  'routelink.devices': (s, _p, nowMs) => {
    requireInstalled(s);
    const now = Math.floor(nowMs / 1000);
    return {
      devices: s.devices
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d.kind === 'wifi' && (d.ap || d.hostname === 'iPhone-16-Pro'))
        .map(({ d, i }) => {
          const online = isStationOf(s, d, 'ap', nowMs);
          return {
            mac: d.mac,
            name: '',
            hostname: '',
            ipv4: [],
            ipv6: [],
            first_seen: Math.floor(s.ap.bootTime / 1000),
            last_seen: online ? now : now - 3600,
            online,
            random_mac: false,
            trusted: false,
            watch: false,
            ...(online ? { ifname: IFNAMES[(d.radio ?? 'radio1') as RadioName], signal: signalAt(s, i, now) } : {}),
            today_rx: 0,
            today_tx: 0,
            rx_rate: 0,
            tx_rate: 0,
          };
        }),
    };
  },
  'routelink.events': (s, p, nowMs) => {
    requireInstalled(s);
    return apEvents(ctxOf(s, nowMs), p);
  },
};

export { DEMO_AP_NAME };
