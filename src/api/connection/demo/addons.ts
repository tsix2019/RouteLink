import type { UciSection } from '../../uci';
import { demoLocaltime } from './admin';
import type { DemoState } from './state';

/** Optional packages on the demo router (M3): DDNS, SQM and ad blocking, with what their LuCI apps read. */

const section = (name: string, type: string, values: Record<string, string | string[]>, anonymous = false) =>
  ({ '.name': name, '.type': type, '.anonymous': anonymous, ...values }) as UciSection;

/** Update URLs as ddns-scripts ships them (a few are update scripts). */
const DDNS_PROVIDERS: Record<string, { ipv4: string; ipv6?: string }> = {
  'afraid.org-keyauth': { ipv4: 'http://freedns.afraid.org/dynamic/update.php?[PASSWORD]&address=[IP]' },
  'cloudflare.com-v4': { ipv4: 'update_cloudflare_com_v4.sh', ipv6: 'update_cloudflare_com_v4.sh' },
  'dnspod.cn': { ipv4: 'update_dnspod_cn.sh', ipv6: 'update_dnspod_cn.sh' },
  'duckdns.org': {
    ipv4: 'http://www.duckdns.org/update?domains=[DOMAIN]&token=[PASSWORD]&ip=[IP]',
    ipv6: 'http://www.duckdns.org/update?domains=[DOMAIN]&token=[PASSWORD]&ipv6=[IP]',
  },
  'dynv6.com': {
    ipv4: 'https://dynv6.com/api/update?hostname=[DOMAIN]&token=[PASSWORD]&ipv4=[IP]',
    ipv6: 'https://dynv6.com/api/update?hostname=[DOMAIN]&token=[PASSWORD]&ipv6=[IP]',
  },
  'he.net': {
    ipv4: 'http://[DOMAIN]:[PASSWORD]@dyn.dns.he.net/nic/update?hostname=[DOMAIN]&myip=[IP]',
    ipv6: 'http://[DOMAIN]:[PASSWORD]@dyn.dns.he.net/nic/update?hostname=[DOMAIN]&myip=[IP]',
  },
  'no-ip.com': { ipv4: 'http://[USERNAME]:[PASSWORD]@dynupdate.no-ip.com/nic/update?hostname=[DOMAIN]&myip=[IP]' },
  'oray.com': { ipv4: 'http://[USERNAME]:[PASSWORD]@ddns.oray.com/ph/update?hostname=[DOMAIN]&myip=[IP]' },
};
const PROVIDERS_DIR = '/usr/share/ddns/default/';

/** adblock-fast's shipped lists (a selection), two of them switched on. */
const BLOCK_LISTS: [name: string, size: number, enabled: boolean][] = [
  ['Hagezi - Pro', 3_476_485, false],
  ['OISD - Big', 6_163_363, false],
  ['StevenBlack - Unified hosts', 4_790_642, true],
  ['1Hosts - Lite', 2_786_010, false],
  ['CERT Polska - Dangerous Websites', 731_479, false],
  ['Kboghdady - YouTube Ads DNS', 553_006, false],
  ['AdAway - Hosts', 243_454, true],
  ['Yoyo.org - Hosts', 99_588, false],
];

export const createAddonUci = (): Record<string, Record<string, UciSection>> => ({
  'adblock-fast': {
    config: section('config', 'adblock-fast', { enabled: '1', dns: 'dnsmasq.servers', force_dns: '1' }),
    ...Object.fromEntries(
      BLOCK_LISTS.map(([name, size, enabled], i) => [
        `cfg_list${i}`,
        section(
          `cfg_list${i}`,
          'file_url',
          {
            name,
            url: `https://lists.example.org/${i}.txt`,
            size: String(size),
            action: 'block',
            enabled: enabled ? '1' : '0',
          },
          true,
        ),
      ]),
    ),
  },
  // Shaping the PPPoE line a little below its 100/20 Mbit/s.
  sqm: {
    pppoe_wan: section('pppoe_wan', 'queue', {
      enabled: '1',
      interface: 'pppoe-wan',
      download: '92000',
      upload: '18000',
      qdisc: 'cake',
      script: 'piece_of_cake.qos',
      qdisc_advanced: '0',
      linklayer: 'ethernet',
      overhead: '38',
    }),
  },
  ddns: {
    global: section('global', 'ddns', { ddns_dateformat: '%F %R', ddns_loglines: '250', upd_privateip: '0' }),
    myddns_ipv4: section('myddns_ipv4', 'service', {
      service_name: 'dyndns.org',
      lookup_host: 'yourhost.example.com',
      domain: 'yourhost.example.com',
      username: 'your_username',
      password: 'your_password',
      interface: 'wan',
      ip_source: 'network',
      ip_network: 'wan',
    }),
    myddns_ipv6: section('myddns_ipv6', 'service', {
      update_url: 'http://[USERNAME]:[PASSWORD]@your.provider.net/nic/update?hostname=[DOMAIN]&myip=[IP]',
      lookup_host: 'yourhost.example.com',
      domain: 'yourhost.example.com',
      username: 'your_username',
      password: 'your_password',
      use_ipv6: '1',
      interface: 'wan6',
      ip_source: 'network',
      ip_network: 'wan6',
    }),
    home: section('home', 'service', {
      enabled: '1',
      service_name: 'duckdns.org',
      domain: 'routelink-demo.duckdns.org',
      lookup_host: 'routelink-demo.duckdns.org',
      password: 'demo-token',
      use_ipv6: '0',
      interface: 'wan',
      ip_source: 'network',
      ip_network: 'wan',
    }),
  },
});

/** "%F %R" in router time. */
function routerDate(s: DemoState, now: number, offsetSec = 0): string {
  return new Date((demoLocaltime(s, now) + offsetSec) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function demoAddonList(path: string): { name: string; type: string }[] | null {
  if (path === PROVIDERS_DIR.slice(0, -1)) {
    return Object.keys(DDNS_PROVIDERS).map((name) => ({ name: `${name}.json`, type: 'file' }));
  }
  if (path === '/var/run/sqm/available_qdiscs') {
    return ['cake', 'fq_codel'].map((name) => ({ name, type: 'file' }));
  }
  return null;
}

/** The ifb devices that sqm creates for download shaping on its enabled queues. */
export const demoSqmDevices = (s: DemoState): string[] =>
  s.services.sqm?.running === false
    ? []
    : Object.values(s.uci.sqm ?? {})
        .filter((q) => q['.type'] === 'queue' && q.enabled === '1' && Number(q.download) > 0)
        .map((q) => `ifb4${String(q.interface)}`);

export function demoAddonFile(path: string): string | null {
  if (path.startsWith(PROVIDERS_DIR)) {
    const name = path.slice(PROVIDERS_DIR.length, -'.json'.length);
    const p = DDNS_PROVIDERS[name];
    if (!p) return null;
    return JSON.stringify({ name, ipv4: { url: p.ipv4 }, ...(p.ipv6 ? { ipv6: { url: p.ipv6 } } : {}) }, null, '\t');
  }
  return null;
}

/** Roughly one domain per 22 bytes of list. */
function adblockFastStatus(s: DemoState) {
  const config = s.uci['adblock-fast']?.config;
  const enabled = config?.enabled === '1';
  const running = enabled && s.services['adblock-fast']?.running !== false;
  const lists = Object.values(s.uci['adblock-fast'] ?? {}).filter((x) => x['.type'] === 'file_url');
  const on = lists.filter((x) => x.enabled !== '0' && x.action !== 'allow');
  const entries = on.reduce((n, x) => n + Math.round(Number(x.size) / 22), 0);
  return {
    'adblock-fast': {
      version: '1.2.4-r4',
      packageCompat: 17,
      enabled,
      running,
      status: !running ? 'statusStopped' : on.length ? 'statusSuccess' : 'statusFail',
      message: '',
      stats: '',
      entries: running ? entries : 0,
      dns: 'dnsmasq.servers',
      errors: running && !on.length ? [{ code: 'errorNothingToDo', info: '' }] : [],
      warnings: [],
    },
  };
}

export const addonHandlers: Record<string, (s: DemoState, p: Record<string, unknown>, now: number) => unknown> = {
  'luci.adblock-fast.getInitStatus': (s) => adblockFastStatus(s),
  'luci.adblock-fast.setInitAction': (s, p) => {
    const svc = s.services['adblock-fast'];
    const config = s.uci['adblock-fast']?.config;
    if (!svc || !config) return { result: false };
    switch (p.action) {
      case 'enable':
      case 'disable':
        svc.enabled = p.action === 'enable';
        config.enabled = svc.enabled ? '1' : '0';
        break;
      case 'start':
      case 'restart':
      case 'reload':
      case 'dl':
        svc.running = true;
        break;
      case 'stop':
        svc.running = false;
        break;
      default:
        return { result: false };
    }
    return { result: true };
  },
  /** Enabled services last updated three hours ago and are waiting for the forced update (72 h + 10 min). */
  'luci.ddns.get_services_status': (s, _p, now) =>
    Object.fromEntries(
      Object.values(s.uci.ddns ?? {})
        .filter((x) => x['.type'] === 'service')
        .map((x) => {
          const on = x.enabled === '1';
          const running = on && s.services.ddns?.running !== false;
          return [
            x['.name'],
            running
              ? {
                  ip: x.use_ipv6 === '1' ? '2001:db8:45::1' : '203.0.113.45',
                  last_update: routerDate(s, now, -3 * 3600),
                  next_update: routerDate(s, now, 69 * 3600 + 600),
                  pid: 4410,
                }
              : { ip: null, last_update: null, next_update: on ? 'Stopped' : 'Disabled', pid: null },
          ];
        }),
    ),
  'luci.ddns.get_env': () => ({
    has_wget: true,
    has_curl: false,
    has_ssl: true,
    has_proxy: true,
    has_forceip: true,
    has_bindnet: true,
    has_bindhost: false,
    has_dnsserver: true,
    has_cacerts: true,
    has_ipv6: true,
  }),
};
