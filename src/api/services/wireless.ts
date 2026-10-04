import type { RouterConnection } from '../connection/types';
import { uci, type UciSection } from '../uci';
import type { UbusCall, UbusResult } from '../ubus/types';
import { bandOf, type Band, type Client } from './clients';

export type Encryption = 'none' | 'psk2' | 'psk-mixed' | 'sae' | 'sae-mixed' | 'owe';
export const ENCRYPTIONS: Encryption[] = ['sae-mixed', 'psk2', 'sae', 'psk-mixed', 'owe', 'none'];

export interface WifiNetwork {
  /** uci wifi-iface section */
  section: string;
  radio: string;
  ifname?: string;
  ssid: string;
  encryption: string;
  key?: string;
  hidden: boolean;
  disabled: boolean;
  network: string[];
  mode: string;
  up: boolean;
}

export interface Radio {
  name: string;
  band: Band;
  /** "auto" or a channel number as string */
  channel: string;
  htmode?: string;
  txpower?: number;
  country?: string;
  disabled: boolean;
  up: boolean;
  networks: WifiNetwork[];
}

interface RawRadio {
  up?: boolean;
  disabled?: boolean;
  config?: { band?: string; hwmode?: string; channel?: string | number; htmode?: string; txpower?: number | string; country?: string };
  interfaces?: { section: string; ifname?: string; config?: Record<string, unknown> }[];
}

const bool = (v: unknown) => v === true || v === '1' || v === 1 || v === 'true';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/\s+/) : []);

/** Runtime status (luci-rpc getWirelessDevices) merged with the stored uci config. */
export function parseRadios(status: Record<string, RawRadio>, config: Record<string, UciSection>): Radio[] {
  const devices = Object.values(config).filter((s) => s['.type'] === 'wifi-device');
  const ifaces = Object.values(config).filter((s) => s['.type'] === 'wifi-iface');
  const names = new Set([...Object.keys(status), ...devices.map((d) => d['.name'])]);

  return [...names].sort().map((name) => {
    const st = status[name] ?? {};
    const dev = devices.find((d) => d['.name'] === name);
    const cfg = { ...(st.config ?? {}), ...(dev ?? {}) } as Record<string, unknown>;
    const runtime = new Map((st.interfaces ?? []).map((i) => [i.section, i]));
    return {
      name,
      band: bandOf({ band: cfg.band as string, hwmode: cfg.hwmode as string, channel: cfg.channel as string }),
      channel: String(cfg.channel ?? 'auto'),
      htmode: cfg.htmode ? String(cfg.htmode) : undefined,
      txpower: cfg.txpower !== undefined && cfg.txpower !== '' ? Number(cfg.txpower) : undefined,
      country: cfg.country ? String(cfg.country) : undefined,
      disabled: bool(cfg.disabled),
      up: st.up ?? false,
      networks: ifaces
        .filter((i) => i.device === name)
        .map((i) => {
          const rt = runtime.get(i['.name']);
          return {
            section: i['.name'],
            radio: name,
            ifname: rt?.ifname,
            ssid: String(i.ssid ?? ''),
            encryption: String(i.encryption ?? 'none'),
            key: typeof i.key === 'string' ? i.key : undefined,
            hidden: bool(i.hidden),
            disabled: bool(i.disabled),
            network: strings(i.network),
            mode: String(i.mode ?? 'ap'),
            up: !!rt?.ifname && (st.up ?? false),
          };
        }),
    };
  });
}

export async function getRadios(conn: RouterConnection): Promise<Radio[]> {
  const [status, config] = await conn.batch([
    { object: 'luci-rpc', method: 'getWirelessDevices' },
    { object: 'uci', method: 'get', params: { config: 'wireless' } },
  ]);
  const values = (r: UbusResult) => (r.ok ? ((r.data as { values?: Record<string, UciSection> }).values ?? {}) : {});
  if (!config.ok && config.error.code !== 'NOT_FOUND') throw config.error;
  return parseRadios(status.ok ? (status.data as Record<string, RawRadio>) : {}, values(config));
}

type RadioPatch = Partial<Pick<Radio, 'channel' | 'htmode' | 'txpower' | 'country' | 'disabled'>>;
type NetworkPatch = Partial<Pick<WifiNetwork, 'ssid' | 'encryption' | 'key' | 'hidden' | 'disabled'>>;

const flag = (b: boolean) => (b ? '1' : '0');

/** Only changed fields are staged. */
export function radioChanges(radio: Radio, patch: RadioPatch): UbusCall[] {
  const values: Record<string, string> = {};
  if (patch.channel !== undefined && patch.channel !== radio.channel) values.channel = patch.channel;
  if (patch.htmode !== undefined && patch.htmode !== radio.htmode) values.htmode = patch.htmode;
  if (patch.txpower !== undefined && patch.txpower !== radio.txpower) values.txpower = String(patch.txpower);
  if (patch.country !== undefined && patch.country !== radio.country) values.country = patch.country;
  if (patch.disabled !== undefined && patch.disabled !== radio.disabled) values.disabled = flag(patch.disabled);
  return Object.keys(values).length ? [uci.set('wireless', radio.name, values)] : [];
}

export function networkChanges(net: WifiNetwork, patch: NetworkPatch): UbusCall[] {
  const values: Record<string, string> = {};
  if (patch.ssid !== undefined && patch.ssid !== net.ssid) values.ssid = patch.ssid;
  if (patch.encryption !== undefined && patch.encryption !== net.encryption) values.encryption = patch.encryption;
  if (patch.key !== undefined && patch.key !== net.key) values.key = patch.key;
  if (patch.hidden !== undefined && patch.hidden !== net.hidden) values.hidden = flag(patch.hidden);
  if (patch.disabled !== undefined && patch.disabled !== net.disabled) values.disabled = flag(patch.disabled);
  return Object.keys(values).length ? [uci.set('wireless', net.section, values)] : [];
}

export type NetworkIssue = 'ssid-empty' | 'ssid-too-long' | 'key-required' | 'key-length';

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

export function validateNetwork(p: { ssid: string; encryption: string; key?: string }): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  if (!p.ssid.trim()) issues.push('ssid-empty');
  else if (utf8Length(p.ssid) > 32) issues.push('ssid-too-long');
  const needsKey = !['none', 'owe'].includes(p.encryption);
  if (needsKey) {
    if (!p.key) issues.push('key-required');
    else if (p.key.length < 8 || p.key.length > 63) issues.push('key-length');
  }
  return issues;
}

export interface ScanResult {
  ssid: string;
  bssid: string;
  channel: number;
  signal: number;
  encryption: string;
}

export async function scan(conn: RouterConnection, ifname: string): Promise<ScanResult[]> {
  const r = await conn.call<{ results?: Record<string, unknown>[] }>('iwinfo', 'scan', { device: ifname }, { timeoutMs: 20_000 });
  return (r.results ?? [])
    .map((s) => {
      const enc = s.encryption as { enabled?: boolean; description?: string; wpa?: number[]; authentication?: string[] } | undefined;
      return {
        ssid: typeof s.ssid === 'string' ? s.ssid : '',
        bssid: String(s.bssid ?? ''),
        channel: Number(s.channel ?? 0),
        signal: Number(s.signal ?? -100),
        encryption: !enc?.enabled
          ? 'none'
          : (enc.description ?? `${(enc.authentication ?? []).join('/') || 'wpa'}${(enc.wpa ?? []).join('/')}`),
      };
    })
    .sort((a, b) => b.signal - a.signal);
}

/**
 * Design §11: only when the phone itself is associated to this network will changing its SSID or key
 * cut us off — then the change is applied without rollback.
 */
export function isPhoneOnNetwork(phoneIp: string | null | undefined, clients: Client[], ifname?: string): boolean {
  if (!phoneIp || !ifname) return false;
  const me = clients.find((c) => c.ipv4 === phoneIp);
  return !!me?.wifi && me.wifi.ifname === ifname;
}
