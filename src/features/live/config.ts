import type { LiveMonitorConfig, LiveMonitorSample, LiveMonitorSession, LiveMonitorTexts } from 'routelink-native';

import type { AgentStatus, Live } from '@/api/services/agent';
import type { Client } from '@/api/services/clients';
import type { AppT } from '@/i18n';

import type { LiveDuration } from './format';

/** Tapping the notification opens the overview (design §16). */
export const LIVE_LINK = 'routelink://overview';
/** The app's accent, as the notification icon tint (app.config.ts: expo-notifications). */
export const LIVE_COLOR = '#0A5BFF';
/** Names handed to the service; more would only bloat every update. */
const MAX_NAMES = 512;

export type LiveSource = LiveMonitorConfig['source'];

/**
 * Where the service gets its numbers: the plugin's `routelink live` when it runs, otherwise LuCI's
 * interface counters on the WAN device (plan P4 §0.8). Null when neither is possible yet.
 */
export function pickSource(
  isDemo: boolean,
  agent: AgentStatus | undefined,
  wanDevice: string | undefined,
): LiveSource | null {
  if (isDemo) return 'demo';
  if (agent?.state === 'ok') return 'agent';
  return wanDevice ? 'luci' : null;
}

/** MAC → the name the app shows (alias, hostname, vendor), for the busiest-device line. */
export function namesOf(clients: readonly Pick<Client, 'mac' | 'name'>[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of (clients ?? []).slice(0, MAX_NAMES)) {
    if (c.name && c.name !== c.mac) out[c.mac.toUpperCase()] = c.name;
  }
  return out;
}

/** The plugin's live reply as a notification sample (busiest five devices). */
export function sampleOfLive(live: Live): LiveMonitorSample {
  return {
    rxBps: live.wan.rxBps,
    txBps: live.wan.txBps,
    online: live.online,
    devices: [...live.devices]
      .sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps))
      .slice(0, 5)
      .map((d) => ({ mac: d.mac, rxBps: d.rxBps, txBps: d.txBps })),
  };
}

/** The overview's own numbers: WAN rates and the online count. */
export function sampleOf(
  latest: { rxBps: number; txBps: number } | undefined,
  online: number | undefined,
): LiveMonitorSample | undefined {
  if (!latest) return undefined;
  return online === undefined
    ? { rxBps: latest.rxBps, txBps: latest.txBps }
    : { rxBps: latest.rxBps, txBps: latest.txBps, online };
}

/** Localised templates; the service fills them in ({rx}, {name}…) without any i18n of its own. */
export function liveTexts(t: AppT): LiveMonitorTexts {
  return {
    channel: t('live:notification.channel'),
    line: t('live:notification.line'),
    lineNoCount: t('live:notification.lineNoCount'),
    top: t('live:notification.top'),
    connecting: t('live:notification.connecting'),
    offlineTitle: t('live:notification.offlineTitle'),
    offlineText: t('live:notification.offlineText'),
    offlineChip: t('live:notification.offlineChip'),
    recovered: t('live:notification.recovered'),
    sessionExpired: t('live:notification.sessionExpired'),
    error: t('live:notification.error'),
    stop: t('live:notification.stop'),
    stoppedTitle: t('live:notification.stoppedTitle'),
    stoppedTls: t('live:notification.stoppedTls'),
    sec: t('live:notification.sec'),
    minSec: t('live:notification.minSec'),
    hourMin: t('live:notification.hourMin'),
    onlineLabel: t('live:notification.onlineLabel'),
  };
}

export interface LiveStartInput {
  routerId: string;
  routerName: string;
  source: LiveSource;
  session?: LiveMonitorSession;
  tlsSha256?: string;
  wanDevice?: string;
  intervalSec: number;
  durationMin: LiveDuration;
  names: Record<string, string>;
  texts: LiveMonitorTexts;
  sample?: LiveMonitorSample;
}

export function buildConfig(input: LiveStartInput): LiveMonitorConfig {
  const config: LiveMonitorConfig = {
    routerId: input.routerId,
    routerName: input.routerName,
    source: input.source,
    intervalSec: input.intervalSec,
    durationMin: input.durationMin,
    names: input.names,
    texts: input.texts,
    link: LIVE_LINK,
    color: LIVE_COLOR,
  };
  if (input.source !== 'demo') {
    if (!input.session) throw new Error('a session is required');
    config.session = input.session;
    if (input.tlsSha256) config.tlsSha256 = input.tlsSha256;
  }
  if (input.wanDevice) config.wanDevice = input.wanDevice;
  if (input.sample) config.sample = input.sample;
  return config;
}
