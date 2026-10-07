import type { Band } from '@/api/services/clients';

/**
 * Channel recommendation (design §17.2, WF-2). Pure: scan results and the radios of the network group in,
 * a suggestion per radio out.
 */

export interface Span {
  /** MHz */
  low: number;
  high: number;
}

export interface ScannedNetwork {
  bssid: string;
  ssid: string;
  band: Band;
  /** Primary channel */
  channel: number;
  signal: number;
  /** Occupied width in MHz (20 when the beacon does not say). */
  width: number;
  /** Centre channel of the occupied block, when the beacon gives it (VHT/HE center_freq_1). */
  center?: number;
  /** The secondary 20 MHz of a 40 MHz block lies above (+1) or below (−1) the primary one. */
  secondary?: 1 | -1;
}

export interface OwnRadio {
  /** Unique within the group, e.g. "<routerId>/<radio>". */
  key: string;
  band: Band;
  /** The channel it is on now (from iwinfo info when the config says auto). */
  channel: number;
  /** MHz */
  width: number;
  /** Channels the radio may use (country, restrictions), before this module's own filters. */
  allowed: number[];
  /** BSSIDs of its own networks: neighbours that are really this group. */
  bssids: string[];
  /** What this radio hears. */
  scan: ScannedNetwork[];
}

export interface ChannelOptions {
  allowDfs?: boolean;
}

export type ChannelReason = 'keep-best' | 'keep-small-gain' | 'change' | 'crowded-24' | 'no-candidates';

export interface ChannelAdvice {
  key: string;
  band: Band;
  current: number;
  /** Channel to switch to; undefined to keep the current one. */
  recommended?: number;
  currentScore: number;
  bestScore: number;
  /** 0–1: how much the interference score drops when switching. */
  reduction: number;
  /** On 2.4 GHz with a 40 MHz channel in a crowded band: go to 20 MHz. */
  suggestWidth20: boolean;
  /** The recommended channel needs radar detection (5 GHz DFS) somewhere in its block at the radio's width. */
  dfs: boolean;
  reason: ChannelReason;
}

export function channelFreq(band: Band, channel: number): number {
  if (band === '2.4G') return channel === 14 ? 2484 : 2407 + 5 * channel;
  if (band === '6G') return channel === 2 ? 5935 : 5950 + 5 * channel;
  return 5000 + 5 * channel;
}

/** Channels 52–64 and 100–144 need radar detection. */
export const isDfs = (band: Band, channel: number): boolean =>
  band === '5G' && ((channel >= 52 && channel <= 64) || (channel >= 100 && channel <= 144));

/** First channel of the 40/80/160 MHz block a 5/6 GHz channel belongs to. */
function blockStart(band: Band, channel: number, width: number): number {
  const n = width / 20;
  // 5 GHz blocks start at 36, 100 and 149; 6 GHz at 1 (channel numbers step by 4).
  const base = band === '6G' ? 1 : channel >= 149 ? 149 : channel >= 100 ? 100 : 36;
  const idx = Math.floor((channel - base) / 4);
  return base + Math.floor(idx / n) * n * 4;
}

/** Frequencies a network on `channel` with `width` occupies. */
export function spanOf(band: Band, channel: number, width: number, center?: number, secondary?: 1 | -1): Span {
  if (center && width > 20) {
    const c = channelFreq(band, center);
    return { low: c - width / 2, high: c + width / 2 };
  }
  const f = channelFreq(band, channel);
  if (width <= 20) return { low: f - 10, high: f + 10 };
  if (band === '2.4G') {
    // HT40 on 2.4 GHz: the secondary channel is 4 channels (20 MHz) away.
    const above = secondary ? secondary > 0 : channel <= 7;
    return above ? { low: f - 10, high: f + 30 } : { low: f - 30, high: f + 10 };
  }
  const start = channelFreq(band, blockStart(band, channel, width));
  return { low: start - 10, high: start - 10 + width };
}

/**
 * A channel at this width needs radar detection when any 20 MHz channel of its block does: 36 at
 * 160 MHz spans 36–64, so it is as much a DFS channel as 52.
 */
export function isDfsBlock(band: Band, channel: number, width: number): boolean {
  if (band !== '5G') return false;
  if (width <= 20) return isDfs(band, channel);
  const span = spanOf(band, channel, width);
  for (let f = span.low + 10; f < span.high; f += 20) if (isDfs(band, (f - 5000) / 5)) return true;
  return false;
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));

/** Signal as a power ratio above the −95 dBm floor. */
const weight = (signal: number) => 10 ** ((signal + 95) / 10);

interface Interferer {
  span: Span;
  signal: number;
  factor: number;
}

function score(band: Band, channel: number, width: number, others: Interferer[]): number {
  const own = spanOf(band, channel, width);
  const w = own.high - own.low;
  return others.reduce((sum, o) => sum + (overlap(own, o.span) / w) * weight(o.signal) * o.factor, 0);
}

function candidates(r: OwnRadio, o: ChannelOptions): number[] {
  if (r.band === '2.4G') return [1, 6, 11].filter((c) => r.allowed.includes(c));
  return r.allowed.filter((c) => o.allowDfs || !isDfsBlock(r.band, c, r.width));
}

/** Own APs heard better than this count as neighbours to stay away from (at double weight). */
const OWN_AUDIBLE = -75;
const STRONG_24 = -70;

/**
 * Radios that hear the most of the group's other APs pick first; each later radio treats the
 * channels already chosen by own APs it hears (above −75 dBm) as interference at twice the weight.
 * A change is only suggested when it at least halves the interference score.
 */
export function recommendChannels(radios: OwnRadio[], o: ChannelOptions = {}): ChannelAdvice[] {
  const ownBssids = new Set(radios.flatMap((r) => r.bssids.map((b) => b.toUpperCase())));
  const ownerOf = new Map<string, OwnRadio>();
  for (const r of radios) for (const b of r.bssids) ownerOf.set(b.toUpperCase(), r);

  const hears = (r: OwnRadio) =>
    r.scan.filter((n) => {
      const owner = ownerOf.get(n.bssid.toUpperCase());
      return owner && owner !== r && owner.band === r.band;
    }).length;
  const order = [...radios].sort((a, b) => hears(b) - hears(a));
  const assigned = new Map<OwnRadio, number>();
  const result = new Map<string, ChannelAdvice>();

  for (const r of order) {
    const external: Interferer[] = r.scan
      .filter((n) => n.band === r.band && !ownBssids.has(n.bssid.toUpperCase()))
      .map((n) => ({ span: spanOf(n.band, n.channel, n.width, n.center, n.secondary), signal: n.signal, factor: 1 }));
    const ownNear: Interferer[] = r.scan
      .filter((n) => n.signal > OWN_AUDIBLE)
      .flatMap((n) => {
        const owner = ownerOf.get(n.bssid.toUpperCase());
        if (!owner || owner === r || owner.band !== r.band || !assigned.has(owner)) return [];
        return [{ span: spanOf(owner.band, assigned.get(owner)!, owner.width), signal: n.signal, factor: 2 }];
      });
    const others = [...external, ...ownNear];
    const currentScore = score(r.band, r.channel, r.width, others);
    const options = candidates(r, o);

    let best = r.channel;
    let bestScore = currentScore;
    for (const c of options) {
      const s = score(r.band, c, r.width, others);
      if (s < bestScore - 1e-9) {
        best = c;
        bestScore = s;
      }
    }

    let reason: ChannelReason;
    let recommended: number | undefined;
    if (!options.length) reason = 'no-candidates';
    else if (best === r.channel) reason = 'keep-best';
    else if (bestScore < currentScore * 0.5) {
      reason = 'change';
      recommended = best;
    } else reason = 'keep-small-gain';
    const final = recommended ?? r.channel;
    assigned.set(r, final);

    const finalSpan = spanOf(r.band, final, 20);
    const strongOnFinal =
      r.band === '2.4G' ? external.filter((e) => overlap(finalSpan, e.span) > 0 && e.signal > STRONG_24).length : 0;
    const suggestWidth20 = r.band === '2.4G' && r.width >= 40 && strongOnFinal >= 3;

    result.set(r.key, {
      key: r.key,
      band: r.band,
      current: r.channel,
      recommended,
      currentScore,
      bestScore: recommended ? bestScore : currentScore,
      reduction: recommended && currentScore > 0 ? 1 - bestScore / currentScore : 0,
      suggestWidth20,
      dfs: recommended !== undefined && isDfsBlock(r.band, recommended, r.width),
      reason: suggestWidth20 && !recommended ? 'crowded-24' : reason,
    });
  }
  return radios.map((r) => result.get(r.key)!);
}

export interface ChannelRow {
  channel: number;
  networks: number;
  strongest?: number;
  /** Own networks of the group on this channel. */
  own: number;
}

/** Per-channel summary of what a radio hears, for the table under the occupancy chart. */
export function channelTable(
  band: Band,
  scan: ScannedNetwork[],
  ownBssids: string[],
  channels: number[],
): ChannelRow[] {
  const own = new Set(ownBssids.map((b) => b.toUpperCase()));
  return channels.map((channel) => {
    const here = scan.filter((n) => n.band === band && n.channel === channel);
    return {
      channel,
      networks: here.length,
      strongest: here.length ? Math.max(...here.map((n) => n.signal)) : undefined,
      own: here.filter((n) => own.has(n.bssid.toUpperCase())).length,
    };
  });
}

/** Width in MHz from a UCI htmode (HT40 → 40, VHT80 → 80, HE160 → 160; legacy NOHT → 20). */
export function widthOfHtmode(htmode?: string): number {
  const m = /(\d+)$/.exec(htmode ?? '');
  const w = m ? Number(m[1]) : 20;
  return [20, 40, 80, 160, 320].includes(w) ? w : 20;
}

interface RawScan {
  ssid?: string;
  bssid?: string;
  channel?: number;
  band?: number;
  mhz?: number;
  signal?: number;
  ht_operation?: { primary_channel?: number; secondary_channel_offset?: string; channel_width?: number };
  vht_operation?: { channel_width?: number; center_freq_1?: number; center_freq_2?: number };
  he_operation?: { channel_width?: number; center_freq_1?: number; center_freq_2?: number };
}

/** iwinfo scan results → scanned networks, with the width the beacon announces. */
export function parseScan(results: RawScan[]): ScannedNetwork[] {
  return results
    .filter((r) => typeof r.channel === 'number' && r.channel > 0)
    .map((r) => {
      const mhz = r.mhz ?? 0;
      const band: Band = r.band === 6 || mhz >= 5925 ? '6G' : r.band === 5 || mhz >= 4900 ? '5G' : '2.4G';
      const ht = r.ht_operation;
      const vht = r.he_operation?.channel_width ? r.he_operation : r.vht_operation;
      let width = 20;
      let center: number | undefined;
      let secondary: 1 | -1 | undefined;
      if (ht?.channel_width && ht.channel_width >= 40) {
        width = 40;
        if (ht.secondary_channel_offset === 'above') secondary = 1;
        else if (ht.secondary_channel_offset === 'below') secondary = -1;
      } else if (ht?.secondary_channel_offset === 'above' || ht?.secondary_channel_offset === 'below') {
        width = 40;
        secondary = ht.secondary_channel_offset === 'above' ? 1 : -1;
      }
      if (vht?.channel_width && vht.channel_width >= 80) {
        width = vht.channel_width >= 160 || (vht.center_freq_2 ?? 0) > 0 ? 160 : 80;
        center = vht.center_freq_1 || undefined;
        if (width === 160 && vht.center_freq_2) center = vht.center_freq_2;
      }
      if (band === '2.4G') width = Math.min(width, 40);
      return {
        bssid: String(r.bssid ?? '').toUpperCase(),
        ssid: r.ssid ?? '',
        band,
        channel: r.channel!,
        signal: r.signal ?? -100,
        width,
        center,
        secondary,
      };
    });
}
