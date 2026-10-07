import type { RouterConnection } from '@/api/connection/types';
import { agentSurvey, type Survey } from '@/api/services/agent-wifi';
import type { Band } from '@/api/services/clients';
import { getRadios, type Radio } from '@/api/services/wireless';
import type { UbusResult } from '@/api/ubus/types';

import {
  channelFreq,
  isDfs,
  parseScan,
  recommendChannels,
  spanOf,
  widthOfHtmode,
  type ChannelAdvice,
  type OwnRadio,
  type ScannedNetwork,
} from './channel';

/**
 * Channel scan of a network group (design §17.2, WF-2): every radio of every router scans, then the
 * group's radios get their recommendations together.
 */

export interface FreqInfo {
  channel: number;
  /** iwinfo: no initiating radiation here before a check (radar channels), or not allowed at all. */
  restricted: boolean;
}

export interface RadioScan {
  /** "<routerId>/<radio>" */
  key: string;
  routerId: string;
  routerName: string;
  radio: Radio;
  band: Band;
  /** The channel it is on now (iwinfo info when the config says auto). */
  channel: number;
  /** MHz */
  width: number;
  htmode?: string;
  /** BSSIDs of its access-point interfaces. */
  bssids: string[];
  freqs: FreqInfo[];
  scan: ScannedNetwork[];
  /** The scan itself failed (the networks list is then empty). */
  scanFailed: boolean;
  /** Busy share (0–100) per channel this radio's plugin knows; the current channel is the fresh one. */
  busy: Record<number, number>;
}

export interface RouterScan {
  routerId: string;
  routerName: string;
  radios: RadioScan[];
}

const data = <T>(r: UbusResult | undefined): T | undefined => (r?.ok ? (r.data as T) : undefined);

/** Radios that are on with at least one access-point interface up (the one that scans). */
const scannable = (radios: Radio[]) =>
  radios.filter((r) => !r.disabled && r.networks.some((n) => n.mode === 'ap' && n.ifname));

/**
 * Channels this radio may use at its width: every 20 MHz channel of the block must be in the frequency
 * list; channels marked restricted are left out unless they are DFS ones (those are decided later by the
 * "allow DFS" option).
 */
export function allowedChannels(band: Band, freqs: FreqInfo[], width: number): number[] {
  const usable = new Set(freqs.filter((f) => !f.restricted || isDfs(band, f.channel)).map((f) => f.channel));
  const listed = new Set(freqs.map((f) => f.channel));
  return [...usable]
    .filter((c) => {
      if (band === '2.4G' || width <= 20) return true;
      const span = spanOf(band, c, width);
      for (let f = span.low + 10; f < span.high; f += 20) {
        const ch = band === '6G' ? (f - 5950) / 5 : (f - 5000) / 5;
        if (!listed.has(ch)) return false;
      }
      return true;
    })
    .sort((a, b) => a - b);
}

/** Busy share per channel from the plugin's survey, for the radio on `ifname`. */
export function busyByChannel(survey: Survey | undefined, ifname: string): Record<number, number> {
  if (!survey) return {};
  const current = survey.radios.find((r) => r.ifname === ifname);
  if (!current) return {};
  const out: Record<number, number> = {};
  for (const c of survey.channels) if (c.phy === current.phy && c.busyPct !== null) out[c.channel] = c.busyPct;
  if (current.busyPct !== null) out[current.channel] = current.busyPct;
  return out;
}

/**
 * Scans every radio of one router: current channel and BSSIDs (iwinfo info per interface), the frequency
 * list, an iwinfo scan per radio, and the plugin's channel load when it has the Wi-Fi module.
 */
export async function scanRouter(conn: RouterConnection, ref: { id: string; name: string }): Promise<RouterScan> {
  const radios = scannable(await getRadios(conn));
  const ifaces = radios.map((r) => r.networks.filter((n) => n.mode === 'ap' && n.ifname).map((n) => n.ifname!));
  const infoCalls = ifaces.flatMap((list) =>
    list.map((ifname) => ({ object: 'iwinfo', method: 'info', params: { device: ifname } })),
  );
  const freqCalls = radios.map((r) => ({ object: 'iwinfo', method: 'freqlist', params: { device: r.name } }));
  const scanCalls = ifaces.map((list) => ({ object: 'iwinfo', method: 'scan', params: { device: list[0] } }));
  const [meta, scans, survey] = await Promise.all([
    radios.length ? conn.batch([...infoCalls, ...freqCalls]) : Promise.resolve([]),
    radios.length ? conn.batch(scanCalls, { timeoutMs: 30_000 }) : Promise.resolve([]),
    // No plugin, or one without the Wi-Fi module: no channel load.
    agentSurvey(conn).catch(() => undefined),
  ]);

  let at = 0;
  return {
    routerId: ref.id,
    routerName: ref.name,
    radios: radios.map((radio, i) => {
      const infos = ifaces[i].map(() => data<{ bssid?: string; channel?: number; htmode?: string }>(meta[at++]));
      const freqs = data<{ results?: { channel?: number; restricted?: boolean }[] }>(meta[infoCalls.length + i]);
      const configured = Number(radio.channel);
      const channel =
        Number.isFinite(configured) && configured > 0 ? configured : (infos.find((x) => x?.channel)?.channel ?? 0);
      const htmode = radio.htmode ?? infos.find((x) => x?.htmode)?.htmode;
      const scanned = data<{ results?: Parameters<typeof parseScan>[0] }>(scans[i]);
      return {
        key: `${ref.id}/${radio.name}`,
        routerId: ref.id,
        routerName: ref.name,
        radio,
        band: radio.band,
        channel,
        width: widthOfHtmode(htmode),
        htmode,
        bssids: infos.flatMap((x) => (x?.bssid ? [x.bssid.toUpperCase()] : [])),
        freqs: (freqs?.results ?? [])
          .filter((f): f is { channel: number; restricted?: boolean } => typeof f.channel === 'number' && f.channel > 0)
          .map((f) => ({ channel: f.channel, restricted: !!f.restricted })),
        scan: parseScan(scanned?.results ?? []).filter((n) => n.band === radio.band),
        scanFailed: !scans[i]?.ok,
        busy: busyByChannel(survey, ifaces[i][0]),
      };
    }),
  };
}

/** What recommendChannels needs to know about a scanned radio. */
export const ownRadio = (r: RadioScan): OwnRadio => ({
  key: r.key,
  band: r.band,
  channel: r.channel,
  width: r.width,
  allowed: allowedChannels(r.band, r.freqs, r.width),
  bssids: r.bssids,
  scan: r.scan,
});

/** Recommendations for the radios whose channel is known, keyed like the radios. */
export function adviseGroup(radios: RadioScan[], allowDfs: boolean): Map<string, ChannelAdvice> {
  const known = radios.filter((r) => r.channel > 0);
  return new Map(recommendChannels(known.map(ownRadio), { allowDfs }).map((a) => [a.key, a]));
}

/** The same mode at 20 MHz: HT40 → HT20, HE40 → HE20. */
export function htmodeAt20(htmode: string | undefined): string | undefined {
  const m = /^([A-Z]+)(\d+)$/.exec(htmode ?? '');
  return m && m[2] !== '20' ? `${m[1]}20` : undefined;
}

export interface ChartNetwork {
  key: string;
  ssid: string;
  low: number;
  high: number;
  signal: number;
  /** A network of this group (another AP, or this radio's other SSIDs). */
  own: boolean;
}

/** The occupancy chart's networks for one radio: what it heard, own ones marked. */
export function chartNetworks(r: RadioScan, ownBssids: ReadonlySet<string>): ChartNetwork[] {
  return r.scan.map((n) => {
    const span = spanOf(n.band, n.channel, n.width, n.center, n.secondary);
    return {
      key: `${n.bssid}/${n.channel}`,
      ssid: n.ssid,
      low: span.low,
      high: span.high,
      signal: n.signal,
      own: ownBssids.has(n.bssid.toUpperCase()),
    };
  });
}

/** Frequency range the chart shows for a band (the radio's channel list, else the usual one). */
export function bandRange(band: Band, channels: number[]): { low: number; high: number } {
  const list = channels.length ? channels : band === '2.4G' ? [1, 13] : band === '5G' ? [36, 165] : [1, 233];
  return {
    low: channelFreq(band, Math.min(...list)) - 10,
    high: channelFreq(band, Math.max(...list)) + 10,
  };
}
