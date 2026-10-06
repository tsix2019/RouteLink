import { UbusError } from '../../ubus/errors';
import type { UciSection } from '../../uci';
import {
  DAY,
  HOUR,
  MINUTE,
  OFFLINE_FOR,
  SLEEPERS,
  TZ_OFFSET,
  localDay,
  localMidnight,
  present,
  sleepWindow,
  type Ctx,
} from './presence';
import { hash01 } from './random';
import type { DemoDevice, DemoState } from './state';

/**
 * Wi-Fi of the demo network (P2): the gateway's radios and those of a demo access point in another room.
 * Both share the demo router's devices; a few of them are associated with the AP, and the iPhone roams to
 * the AP every morning. Signal, rates and channel load come from deterministic waves like the traffic.
 */

export type Side = 'gateway' | 'ap';
export type RadioName = 'radio0' | 'radio1';

export const DEMO_AP_ID = 'demo-ap';
export const DEMO_AP_NAME = 'RouteLink Demo AP';

export const IFNAMES: Record<RadioName, string> = { radio0: 'phy0-ap0', radio1: 'phy1-ap0' };
const BSSIDS: Record<Side, Record<RadioName, string>> = {
  gateway: { radio0: '94:83:C4:00:00:01', radio1: '94:83:C4:00:00:02' },
  ap: { radio0: '94:83:C4:00:01:01', radio1: '94:83:C4:00:01:02' },
};
const NOISE: Record<RadioName, number> = { radio0: -92, radio1: -95 };

/** Wi-Fi devices associated with the AP instead of the gateway. */
export const ON_AP = new Set(['Living-Room-TV', 'Echo-Dot', 'Front-Camera', 'iPad']);
/** Roams to the AP every morning from 07:30 to 07:50 local time (breakfast in the kitchen). */
const ROAMER = 'iPhone-16-Pro';
const ROAM_FROM = 7 * HOUR + 30 * MINUTE;
const ROAM_TO = 7 * HOUR + 50 * MINUTE;

const SIGNAL_RETENTION = { signal_minute_days: 7, signal_hour_days: 30 };
export { SIGNAL_RETENTION };

export function wirelessUci(state: DemoState, side: Side): Record<string, UciSection> {
  return side === 'ap' ? state.ap.uci.wireless : state.uci.wireless;
}

/** Which side device `i` is associated with at `t` (epoch seconds). */
export function sideAt(state: DemoState, i: number, t: number): Side {
  const d = state.devices[i];
  if (d.hostname === ROAMER) {
    const s = t - localMidnight(t);
    if (s >= ROAM_FROM && s < ROAM_TO) return 'ap';
  }
  return d.ap ? 'ap' : 'gateway';
}

/** Associated right now with `side` (kicked stations stay away until their ban ends). */
export function isStationOf(state: DemoState, d: DemoDevice, side: Side, nowMs: number): boolean {
  const i = state.devices.indexOf(d);
  return (
    d.kind === 'wifi' &&
    d.online &&
    !(d.bannedUntil && d.bannedUntil > nowMs) &&
    sideAt(state, i, Math.floor(nowMs / 1000)) === side
  );
}

export function channelFreq(channel: number): number {
  if (channel === 14) return 2484;
  return channel <= 14 ? 2407 + channel * 5 : 5000 + channel * 5;
}

/** The channel a radio is on (its configured one, or what "auto" picked). */
export function radioChannel(state: DemoState, side: Side, radio: RadioName): number {
  const c = Number(wirelessUci(state, side)[radio]?.channel);
  return Number.isFinite(c) && c > 0 ? c : radio === 'radio0' ? 6 : 149;
}

const radioWidth = (state: DemoState, side: Side, radio: RadioName): number => {
  const m = /(\d+)$/.exec(String(wirelessUci(state, side)[radio]?.htmode ?? ''));
  return m ? Number(m[1]) : 20;
};

/** iwinfo accepts a radio name or one of its interfaces. */
export function demoRadio(device: unknown): RadioName {
  const name = String(device);
  if (name === 'radio0' || name === 'radio1') return name;
  const radio = (Object.keys(IFNAMES) as RadioName[]).find((r) => IFNAMES[r] === name);
  if (radio) return radio;
  throw new UbusError('NOT_FOUND', 'iwinfo');
}

function ifaceSections(state: DemoState, side: Side, radio: RadioName) {
  return Object.values(wirelessUci(state, side)).filter((s) => s['.type'] === 'wifi-iface' && s.device === radio);
}

const radioUp = (state: DemoState, side: Side, radio: RadioName) => wirelessUci(state, side)[radio]?.disabled !== '1';

export function radioStatus(state: DemoState, side: Side, radio: RadioName) {
  const dev = wirelessUci(state, side)[radio];
  const disabled = dev.disabled === '1';
  return {
    up: !disabled,
    pending: false,
    autostart: true,
    disabled,
    retry_setup_failed: false,
    config: {
      type: 'mac80211',
      band: dev.band,
      channel: dev.channel,
      htmode: dev.htmode,
      country: dev.country,
      txpower: dev.txpower,
    },
    interfaces: ifaceSections(state, side, radio).map((i) => ({
      section: i['.name'],
      ifname: disabled || i.disabled === '1' ? undefined : IFNAMES[radio],
      config: { mode: i.mode, ssid: i.ssid, encryption: i.encryption, network: [i.network] },
      vlans: [],
      stations: [],
    })),
  };
}

// ---- stations: signal and rates as slow waves around each device's own level ----

/** dBm at second `t`. */
export function signalAt(state: DemoState, i: number, t: number): number {
  const base = state.devices[i].signal;
  const phase = hash01(i, 31) * 2 * Math.PI;
  const wave = 3 * Math.sin((2 * Math.PI * t) / 900 + phase);
  const jitter = 4 * (hash01(i, Math.floor(t / 7), 37) - 0.5);
  return Math.round(base + wave + jitter);
}

/** Negotiated rates (kbit/s) drop as the signal weakens. */
function ratesAt(state: DemoState, i: number, t: number): { tx: number; rx: number } {
  const d = state.devices[i];
  const factor = Math.min(1, Math.max(0.3, 1 - Math.max(0, -58 - signalAt(state, i, t)) / 30));
  return { tx: Math.round(d.txRate * factor), rx: Math.round(d.rxRate * factor) };
}

/** Share of frames sent again: grows as the signal weakens. */
const retryShare = (signal: number) => Math.min(0.35, Math.max(0.01, (-50 - signal) / 110));
const PACKETS_PER_SEC = 60;

function stationJson(ctx: Ctx, i: number, side: Side) {
  const d = ctx.state.devices[i];
  const radio = d.radio ?? 'radio1';
  const t = ctx.now;
  const signal = signalAt(ctx.state, i, t);
  const rates = ratesAt(ctx.state, i, t);
  const connected = d.connectedSec;
  const packets = connected * PACKETS_PER_SEC;
  const retries = Math.round(packets * retryShare(signal));
  const width = Math.min(radioWidth(ctx.state, side, radio), radio === 'radio0' ? 40 : 160);
  return {
    mac: d.mac,
    ifname: IFNAMES[radio],
    freq: channelFreq(radioChannel(ctx.state, side, radio)),
    signal,
    signal_avg: signal - 1,
    noise: NOISE[radio],
    inactive_ms: 20 + Math.floor(hash01(i, Math.floor(t / 5), 41) * 900),
    connected_sec: connected,
    rx_rate: rates.rx,
    tx_rate: rates.tx,
    rx_mcs: radio === 'radio0' ? 7 : 9,
    tx_mcs: radio === 'radio0' ? 7 : 11,
    rx_nss: 2,
    tx_nss: 2,
    width,
    mode: 'he',
    rx_bytes: packets * 900,
    tx_bytes: packets * 1100,
    rx_packets: packets,
    tx_packets: packets,
    tx_retries: retries,
    tx_failed: Math.round(retries * 0.03),
  };
}

function interfacesJson(state: DemoState, side: Side, nowMs: number) {
  return (Object.keys(IFNAMES) as RadioName[])
    .filter((r) => radioUp(state, side, r))
    .flatMap((radio) =>
      ifaceSections(state, side, radio)
        .filter((i) => i.disabled !== '1')
        .map((i) => ({
          ifname: IFNAMES[radio],
          phy: radio === 'radio0' ? 'phy0' : 'phy1',
          ssid: String(i.ssid ?? ''),
          bssid: BSSIDS[side][radio],
          freq: channelFreq(radioChannel(state, side, radio)),
          channel: radioChannel(state, side, radio),
          width: radioWidth(state, side, radio),
          noise: NOISE[radio],
          stations: state.devices.filter((d) => d.radio === radio && isStationOf(state, d, side, nowMs)).length,
        })),
    );
}

function stations(ctx: Ctx, side: Side, p: Record<string, unknown>, nowMs: number) {
  const live = p.live === true;
  return {
    ts: ctx.now,
    live_until: live ? ctx.now + 30 : 0,
    interfaces: interfacesJson(ctx.state, side, nowMs),
    stations: ctx.state.devices
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => isStationOf(ctx.state, d, side, nowMs))
      .map(({ i }) => stationJson(ctx, i, side)),
  };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const invalid = () => new UbusError('INVALID_ARGUMENT', 'routelink');

/** Signal history (plan §1.3): 1-second points within the last 10 minutes, then minutes (7 days), hours (30). */
function signal(ctx: Ctx, side: Side, p: Record<string, unknown>) {
  const start = num(p.start);
  const end = num(p.end);
  if (start === undefined || end === undefined || start >= end) throw invalid();
  const maxPoints = num(p.max_points) ?? 500;
  if (maxPoints < 1 || maxPoints > 1000) throw invalid();
  const mac = typeof p.mac === 'string' ? p.mac.toUpperCase() : '';
  const i = ctx.state.devices.findIndex((d) => d.mac === mac && d.kind === 'wifi');
  // Only the side the station has been on knows it.
  const knows = i >= 0 && (ctx.state.devices[i].hostname === ROAMER || sideAt(ctx.state, i, ctx.now) === side);
  if (!knows) throw new UbusError('NOT_FOUND', 'routelink');

  const tier = start >= ctx.now - 600 ? 'live' : start >= ctx.now - 7 * DAY ? 'minute' : 'hour';
  const unit = tier === 'live' ? 1 : tier === 'minute' ? MINUTE : HOUR;
  const first = Math.floor(start / unit) * unit;
  const step = unit * Math.max(1, Math.ceil((end - first) / unit / maxPoints));
  const oldest = ctx.now - SIGNAL_RETENTION.signal_hour_days * DAY;
  const d = ctx.state.devices[i];
  const points: (number | null)[][] = [];
  for (let t = first; t < end; t += step) {
    const mid = Math.min(t + step / 2, ctx.now);
    const here =
      t <= ctx.now &&
      t >= oldest &&
      present(ctx, i, mid) &&
      sideAt(ctx.state, i, mid) === side &&
      !(d.bannedUntil && d.bannedUntil > mid * 1000);
    if (!here) {
      points.push([t, null, null, null, null, null, null]);
      continue;
    }
    const avg = signalAt(ctx.state, i, mid);
    const rates = ratesAt(ctx.state, i, mid);
    const packets = step * PACKETS_PER_SEC;
    const retries = Math.round(packets * retryShare(avg));
    points.push([
      t,
      avg,
      avg - 2 - Math.floor(hash01(i, t, 43) * 5),
      rates.tx,
      rates.rx,
      retries,
      Math.round(retries * 0.03),
    ]);
  }
  return { start, end, step, tier, points };
}

/** Busy share of a channel this minute: 2.4 GHz is crowded, 5 GHz mostly quiet. */
function busyPct(radio: RadioName, channel: number, minute: number, side: Side): number {
  const salt = side === 'ap' ? 53 : 47;
  return radio === 'radio0'
    ? Math.round(32 + 26 * hash01(channel, minute, salt))
    : Math.round(6 + 16 * hash01(channel, minute, salt));
}

function survey(ctx: Ctx, side: Side) {
  const minute = Math.floor(ctx.now / MINUTE);
  const radios = (Object.keys(IFNAMES) as RadioName[]).filter((r) => radioUp(ctx.state, side, r));
  return {
    radios: radios.map((radio) => {
      const channel = radioChannel(ctx.state, side, radio);
      const busy = busyPct(radio, channel, minute, side);
      return {
        ifname: IFNAMES[radio],
        phy: radio === 'radio0' ? 'phy0' : 'phy1',
        freq: channelFreq(channel),
        channel,
        noise: NOISE[radio],
        active_ms: 60_000,
        busy_ms: busy * 600,
        rx_ms: Math.round(busy * 600 * 0.7),
        tx_ms: Math.round(busy * 600 * 0.2),
        busy_pct: busy,
        updated: minute * MINUTE,
      };
    }),
    channels: radios.flatMap((radio) =>
      (radio === 'radio0' ? [1, 6, 11] : [36, 40, 44, 48, 149, 153, 157, 161]).map((channel) => ({
        phy: radio === 'radio0' ? 'phy0' : 'phy1',
        freq: channelFreq(channel),
        channel,
        noise: NOISE[radio] - 1,
        busy_pct: busyPct(radio, channel, Math.floor(minute / 10), side),
      })),
    ),
  };
}

export interface WifiEvent {
  ts: number;
  type: 'wifi_connect' | 'wifi_disconnect';
  mac: string;
  value: number;
}

/** Associations and departures seen by `side`: nightly sleep, the devices that left, the iPhone's roaming. */
export function wifiEvents(ctx: Ctx, side: Side, from: number, to: number): WifiEvent[] {
  const out: WifiEvent[] = [];
  const freq = (d: DemoDevice) => channelFreq(radioChannel(ctx.state, side, d.radio ?? 'radio1'));
  ctx.state.devices.forEach((d, i) => {
    if (d.kind !== 'wifi') return;
    const home: Side = d.ap ? 'ap' : 'gateway';
    for (let day = localDay(from) - 1; day <= localDay(to); day++) {
      const midnight = day * DAY - TZ_OFFSET;
      if (SLEEPERS.has(d.hostname) && home === side) {
        const [sleep, wake] = sleepWindow(i, day);
        out.push({ ts: Math.ceil(midnight + sleep), type: 'wifi_disconnect', mac: d.mac, value: freq(d) });
        out.push({ ts: Math.ceil(midnight + wake), type: 'wifi_connect', mac: d.mac, value: freq(d) });
      }
      if (d.hostname === ROAMER) {
        const [leave, back] =
          side === 'gateway'
            ? (['wifi_disconnect', 'wifi_connect'] as const)
            : (['wifi_connect', 'wifi_disconnect'] as const);
        out.push({ ts: midnight + ROAM_FROM, type: leave, mac: d.mac, value: freq(d) });
        out.push({ ts: midnight + ROAM_TO, type: back, mac: d.mac, value: freq(d) });
      }
    }
    if (!d.online && home === side)
      out.push({ ts: ctx.now - OFFLINE_FOR, type: 'wifi_disconnect', mac: d.mac, value: freq(d) });
  });
  return out.filter((e) => e.ts >= from && e.ts < to && e.ts <= ctx.now);
}

// ---- iwinfo: what each side's radios report and hear ----

/** Neighbours: SSID, primary channel, signal at the gateway, encryption, width (MHz), secondary offset. */
const NEIGHBOURS = [
  ['ChinaNet-5G-8A2F', 149, -58, 'WPA2 PSK (CCMP)', 80],
  ['TP-LINK_3C9E', 1, -63, 'WPA2 PSK (CCMP)', 20],
  ['Xiaomi_AX6000', 44, -67, 'WPA3 SAE (CCMP)', 80],
  ['CMCC-Home', 11, -71, 'WPA2 PSK (CCMP)', 40],
  ['', 6, -74, 'WPA2 PSK (CCMP)', 20],
  ['Neighbor-Guest', 6, -79, 'none', 20],
  ['HUAWEI-B3', 157, -82, 'WPA2/WPA3 PSK/SAE (CCMP)', 80],
] as const;

/** First channel of the 80 MHz block a 5 GHz channel belongs to, plus 6 = its centre channel. */
const center80 = (channel: number) => {
  const base = channel >= 149 ? 149 : channel >= 100 ? 100 : 36;
  return base + Math.floor((channel - base) / 16) * 16 + 6;
};

function scanEntry(ssid: string, bssid: string, channel: number, signal: number, enc: string, width: number) {
  const is24 = channel <= 14;
  const secondary = width >= 40 ? (is24 ? (channel <= 7 ? 'above' : 'below') : 'above') : 'no secondary';
  return {
    ssid: ssid || undefined,
    bssid,
    mode: 'Master',
    band: is24 ? 2 : 5,
    channel,
    mhz: channelFreq(channel),
    signal,
    quality: Math.max(0, Math.min(70, signal + 110)),
    quality_max: 70,
    ht_operation: {
      primary_channel: channel,
      secondary_channel_offset: secondary,
      channel_width: width >= 40 ? 2040 : 20,
    },
    ...(!is24 && width >= 80
      ? { vht_operation: { channel_width: width, center_freq_1: center80(channel), center_freq_2: 0 } }
      : {}),
    encryption: enc === 'none' ? { enabled: false } : { enabled: true, description: enc },
  };
}

function scan(state: DemoState, side: Side, radio: RadioName) {
  const neighbours = NEIGHBOURS.filter(([, ch]) => (radio === 'radio0') === ch <= 14).map(
    ([ssid, channel, sig, enc, width], k) =>
      scanEntry(
        ssid,
        `5C:A6:E6:${(16 + k).toString(16).toUpperCase()}:4A:${(32 + k * 7).toString(16).toUpperCase()}`,
        channel,
        // The AP is on the other side of the flat: it hears the neighbours differently.
        side === 'ap' ? sig + Math.round(8 * (hash01(k, 59) - 0.5)) - 3 : sig,
        enc,
        width,
      ),
  );
  // Each side hears the other's networks through a wall or two.
  const other: Side = side === 'ap' ? 'gateway' : 'ap';
  const own = radioUp(state, other, radio)
    ? ifaceSections(state, other, radio)
        .filter((i) => i.disabled !== '1')
        .map((i) =>
          scanEntry(
            String(i.ssid ?? ''),
            BSSIDS[other][radio],
            radioChannel(state, other, radio),
            radio === 'radio0' ? -61 : -68,
            String(i.encryption).startsWith('sae') ? 'WPA2/WPA3 PSK/SAE (CCMP)' : 'WPA2 PSK (CCMP)',
            radioWidth(state, other, radio),
          ),
        )
    : [];
  return { results: [...own, ...neighbours] };
}

const CHANNELS_2G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const CHANNELS_5G = [
  36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165,
];

type Handler = (state: DemoState, params: Record<string, unknown>, now: number) => unknown;
const ctxOf = (state: DemoState, nowMs: number): Ctx => ({ state, now: Math.floor(nowMs / 1000) });

/** luci-rpc and iwinfo calls about one side's radios. */
export function wirelessHandlers(side: Side): Record<string, Handler> {
  return {
    'luci-rpc.getWirelessDevices': (s) => ({
      radio0: radioStatus(s, side, 'radio0'),
      radio1: radioStatus(s, side, 'radio1'),
    }),
    'iwinfo.assoclist': (s, p, now) => {
      const radio = (Object.keys(IFNAMES) as RadioName[]).find((r) => IFNAMES[r] === p.device);
      return {
        results: s.devices
          .map((d, i) => ({ d, i }))
          .filter(({ d }) => d.radio === radio && isStationOf(s, d, side, now))
          .map(({ d, i }) => {
            const t = Math.floor(now / 1000);
            const rates = ratesAt(s, i, t);
            return {
              mac: d.mac,
              signal: signalAt(s, i, t),
              noise: NOISE[d.radio ?? 'radio1'],
              inactive: 30 + (d.connectedSec % 900),
              connected_time: d.connectedSec + Math.floor((now - s.lastTick) / 1000),
              rx: { rate: rates.rx },
              tx: { rate: rates.tx },
            };
          }),
      };
    },
    'iwinfo.info': (s, p) => {
      const radio = demoRadio(p.device);
      const channel = radioChannel(s, side, radio);
      return {
        phy: radio === 'radio0' ? 'phy0' : 'phy1',
        bssid: BSSIDS[side][radio],
        mode: 'Master',
        channel,
        frequency: channelFreq(channel),
        htmode: wirelessUci(s, side)[radio]?.htmode,
        noise: NOISE[radio],
        htmodes:
          radio === 'radio0'
            ? ['HT20', 'HT40', 'HE20', 'HE40']
            : ['HT20', 'HT40', 'VHT20', 'VHT40', 'VHT80', 'VHT160', 'HE20', 'HE40', 'HE80', 'HE160'],
        hwmodes: radio === 'radio0' ? ['b', 'g', 'n', 'ax'] : ['a', 'n', 'ac', 'ax'],
      };
    },
    'iwinfo.freqlist': (_s, p) => ({
      results: (demoRadio(p.device) === 'radio0' ? CHANNELS_2G : CHANNELS_5G).map((channel) => ({
        channel,
        mhz: channelFreq(channel),
        restricted: channel >= 52 && channel <= 144,
      })),
    }),
    'iwinfo.txpowerlist': (_s, p) => ({
      results: Array.from({ length: demoRadio(p.device) === 'radio0' ? 21 : 24 }, (_, dbm) => ({
        dbm,
        mw: Math.round(10 ** (dbm / 10)),
      })),
    }),
    'iwinfo.scan': (s, p) => scan(s, side, demoRadio(p.device)),
    'luci.getFeatures': () => ({
      wifi: true,
      hostapd: { cli: false, '11ax': true, '11r': true, acs: true, owe: true, sae: true, wps: true, eap: false },
    }),
  };
}

const requireInstalled = (state: DemoState) => {
  if (!state.agent.installed) throw new UbusError('PERMISSION_DENIED', 'routelink');
};

/** The plugin's wireless methods (stations, signal, survey) on one side. */
export function wifiAgentHandlers(side: Side): Record<string, Handler> {
  const installed =
    (fn: (ctx: Ctx, p: Record<string, unknown>, nowMs: number) => unknown): Handler =>
    (s, p, nowMs) => {
      requireInstalled(s);
      return fn(ctxOf(s, nowMs), p, nowMs);
    };
  return {
    'routelink.stations': installed((ctx, p, nowMs) => stations(ctx, side, p, nowMs)),
    'routelink.signal': installed((ctx, p) => signal(ctx, side, p)),
    'routelink.survey': installed((ctx) => survey(ctx, side)),
  };
}

/** hostapd objects are per interface ("hostapd.phy1-ap0"): a kick keeps the station away for a while. */
export function hostapdHandler(object: string, side: Side): Handler | undefined {
  if (!object.startsWith('hostapd.')) return undefined;
  const ifname = object.slice('hostapd.'.length);
  return (s, p, now) => {
    if (!Object.values(IFNAMES).includes(ifname)) throw new UbusError('NOT_FOUND', `${object}.del_client`);
    const d = s.devices.find((x) => x.mac.toLowerCase() === String(p.addr).toLowerCase());
    if (d && isStationOf(s, d, side, now)) d.bannedUntil = now + Math.max(15_000, Number(p.ban_time ?? 0));
    return {};
  };
}
