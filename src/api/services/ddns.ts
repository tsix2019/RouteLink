import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';
import type { UbusCall } from '../ubus/types';
import { stageAndApply, uci, type UciSection, type UciValues } from '../uci';
import { serviceAction } from './services';

/** NW-9: ddns-scripts services, with the status that luci-app-ddns's rpcd script works out. */

const PROVIDERS_DIR = '/usr/share/ddns/default';
const CUSTOM_DIR = '/usr/share/ddns/custom';
/** The package's examples, hidden until someone fills them in. */
const EXAMPLES = new Set(['myddns_ipv4', 'myddns_ipv6']);
const EXAMPLE_DOMAIN = 'yourhost.example.com';

export interface DdnsStatus {
  /** Address registered at the provider, as last seen. */
  ip?: string;
  /** Router-formatted time of the last update. */
  lastUpdate?: string;
  /** Router-formatted time of the next forced update, or one of the states. */
  next?: 'verify' | 'once' | 'disabled' | 'stopped' | string;
  running: boolean;
}

export interface DdnsService {
  section: string;
  enabled: boolean;
  /** A file from /usr/share/ddns, or '' for a custom update URL. */
  provider: string;
  updateUrl?: string;
  domain: string;
  username: string;
  password: string;
  ipv6: boolean;
  /** Address from the WAN interface, from a web check, or another way set up elsewhere. */
  source: 'wan' | 'web' | 'other';
  status: DdnsStatus;
}

type RawStatus = Record<
  string,
  { ip?: string | null; last_update?: string | null; next_update?: string | null; pid?: number | null }
>;

const NEXT_WORDS: Record<string, DdnsStatus['next']> = {
  Verify: 'verify',
  'Run once': 'once',
  Disabled: 'disabled',
  Stopped: 'stopped',
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseDdns(values: Record<string, UciSection>, status: RawStatus): DdnsService[] {
  return Object.values(values)
    .filter((s) => s['.type'] === 'service')
    .sort((a, b) => Number(a['.index'] ?? 0) - Number(b['.index'] ?? 0))
    .filter((s) => !(EXAMPLES.has(s['.name']) && s.enabled !== '1' && s.domain === EXAMPLE_DOMAIN))
    .map((s) => {
      const raw = status[s['.name']];
      const st: DdnsStatus = { running: raw?.pid != null };
      if (raw?.ip) st.ip = raw.ip.replace(/<br\s*\/?>/g, ', ');
      if (raw?.last_update) st.lastUpdate = raw.last_update;
      if (raw?.next_update) st.next = NEXT_WORDS[raw.next_update] ?? raw.next_update;
      const service: DdnsService = {
        section: s['.name'],
        enabled: s.enabled === '1',
        provider: str(s.service_name),
        domain: str(s.domain),
        username: str(s.username),
        password: str(s.password),
        ipv6: s.use_ipv6 === '1',
        source: s.ip_source === 'web' ? 'web' : (s.ip_source ?? 'network') === 'network' ? 'wan' : 'other',
        status: st,
      };
      if (typeof s.update_url === 'string') service.updateUrl = s.update_url;
      return service;
    });
}

export interface ProviderNeeds {
  username: boolean;
  password: boolean;
  ipv4: boolean;
  ipv6: boolean;
}

/** From a provider file: placeholders in its update URL; update scripts (Cloudflare and the like) take both. */
export function providerNeeds(json: string): ProviderNeeds | null {
  let p: { ipv4?: { url?: string }; ipv6?: { url?: string } };
  try {
    p = JSON.parse(json);
  } catch {
    return null;
  }
  const url = p.ipv4?.url ?? p.ipv6?.url ?? '';
  const script = /\.sh$/.test(url);
  return {
    username: script || url.includes('[USERNAME]'),
    password: script || url.includes('[PASSWORD]'),
    ipv4: !!p.ipv4,
    ipv6: !!p.ipv6,
  };
}

const needsOfUrl = (url: string): ProviderNeeds => ({
  username: url.includes('[USERNAME]'),
  password: url.includes('[PASSWORD]'),
  ipv4: true,
  ipv6: true,
});

export async function readProvider(conn: RouterConnection, name: string): Promise<ProviderNeeds | null> {
  if (!/^[\w.-]+$/.test(name)) return null;
  for (const dir of [PROVIDERS_DIR, CUSTOM_DIR]) {
    try {
      const r = await conn.call<{ data?: string }>('file', 'read', { path: `${dir}/${name}.json` });
      return providerNeeds(r.data ?? '');
    } catch {
      // try the next place
    }
  }
  return null;
}

export interface DdnsInput {
  /** '' for a custom update URL. */
  provider: string;
  updateUrl: string;
  /** What to update; Cloudflare-style "host@zone" is accepted. */
  domain: string;
  username: string;
  password: string;
  ipv6: boolean;
  source: 'wan' | 'web' | 'other';
  enabled: boolean;
}

export type DdnsError = Partial<Record<keyof DdnsInput, 'required' | 'domain-invalid' | 'url-invalid' | 'unsupported'>>;

export function validateDdns(input: DdnsInput, needs: ProviderNeeds | null): DdnsError {
  const errors: DdnsError = {};
  const custom = !input.provider;
  const n = custom ? needsOfUrl(input.updateUrl) : needs;
  if (custom && !/^https?:\/\/\S+$/.test(input.updateUrl.trim())) errors.updateUrl = 'url-invalid';
  if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(@[A-Za-z0-9_-]+)?(\.[A-Za-z0-9_-]+)+$/.test(input.domain.trim())) {
    errors.domain = 'domain-invalid';
  }
  if (n?.username && !input.username.trim()) errors.username = 'required';
  if (n?.password && !input.password) errors.password = 'required';
  if (n && (input.ipv6 ? !n.ipv6 : !n.ipv4)) errors.ipv6 = 'unsupported';
  return errors;
}

/** A section name from the domain: "myhome.duckdns.org" → "myhome_duckdns_org". */
function sectionName(domain: string, taken: string[]): string {
  const base =
    domain
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28) || 'ddns';
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}_${i}`;
  return name;
}

export function ddnsChanges(input: DdnsInput, sections: string[], existing?: DdnsService): UbusCall[] {
  const domain = input.domain.trim();
  const values: UciValues = { enabled: input.enabled ? '1' : '0' };
  if (input.provider) values.service_name = input.provider;
  else values.update_url = input.updateUrl.trim();
  values.domain = domain;
  // The name to look up for the registered address; "host@zone" means host.zone.
  values.lookup_host = domain.replace('@', '.');
  if (input.username.trim()) values.username = input.username.trim();
  if (input.password) values.password = input.password;
  values.use_ipv6 = input.ipv6 ? '1' : '0';
  const wan = input.ipv6 ? 'wan6' : 'wan';
  if (input.source !== 'other') {
    values.interface = wan;
    values.ip_source = input.source === 'web' ? 'web' : 'network';
    if (input.source === 'wan') values.ip_network = wan;
  }
  if (!existing) return [uci.add('ddns', 'service', values, sectionName(domain, sections))];
  const changes = [uci.set('ddns', existing.section, values)];
  const drop = (option: string, had: boolean) => {
    if (had && !(option in values)) changes.push(uci.delOption('ddns', existing.section, option));
  };
  drop('service_name', !!existing.provider);
  drop('update_url', existing.updateUrl !== undefined);
  drop('username', !!existing.username);
  drop('password', !!existing.password);
  drop('ip_network', existing.source === 'wan');
  return changes;
}

export const deleteDdnsChanges = (service: DdnsService): UbusCall[] => [uci.del('ddns', service.section)];

export interface DdnsState {
  installed: boolean;
  services: DdnsService[];
  /** Provider files on the router, sorted. */
  providers: string[];
  /** Section names in use (new services must not clash). */
  sections: string[];
}

export async function getDdns(conn: RouterConnection): Promise<DdnsState> {
  const [config, status, list] = await conn.batch([
    { object: 'uci', method: 'get', params: { config: 'ddns' } },
    { object: 'luci.ddns', method: 'get_services_status' },
    { object: 'file', method: 'list', params: { path: PROVIDERS_DIR } },
  ]);
  if (!config.ok) {
    if (config.error instanceof UbusError && config.error.code === 'NOT_FOUND') {
      return { installed: false, services: [], providers: [], sections: [] };
    }
    throw config.error;
  }
  const values = (config.data as { values?: Record<string, UciSection> }).values ?? {};
  const entries = list.ok ? ((list.data as { entries?: { name: string }[] }).entries ?? []) : [];
  return {
    installed: true,
    services: parseDdns(values, status.ok ? (status.data as RawStatus) : {}),
    providers: entries
      .map((e) => e.name)
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -5))
      .sort(),
    sections: Object.keys(values),
  };
}

/** DDNS does not touch the connection: applied directly, then the daemons restart with the new config. */
export async function saveDdns(conn: RouterConnection, changes: UbusCall[]): Promise<void> {
  await stageAndApply(conn, changes, { mode: 'direct' });
  await serviceAction(conn, 'ddns', 'enable');
  await serviceAction(conn, 'ddns', 'restart');
}
