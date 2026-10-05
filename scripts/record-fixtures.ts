// Records real ubus responses as JSON fixtures for unit tests.
// Usage: ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npx tsx scripts/record-fixtures.ts <set>
//   --agent records the router plugin's calls instead (scripts/agent-router.sh with scripts/traffic-lab.sh).
// Only run against disposable routers (Docker/QEMU): fixtures are committed to a public repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { nodeHttpClient } from '../src/api/http/node';
import { UbusSession } from '../src/api/ubus/session';
import type { UbusCall } from '../src/api/ubus/types';
import { fixtureName } from '../test/fixture-names';

const access = (scope: 'ubus' | 'file', object: string, fn: string): UbusCall => ({
  object: 'session',
  method: 'access',
  params: { scope, object, function: fn },
});
const exec = (command: string, params?: string[]): UbusCall => ({
  object: 'file',
  method: 'exec',
  params: params ? { command, params } : { command },
});

export const CALLS: UbusCall[] = [
  { object: 'system', method: 'board' },
  { object: 'system', method: 'info' },
  { object: 'network.interface', method: 'dump' },
  { object: 'network.device', method: 'status' },
  { object: 'luci-rpc', method: 'getNetworkDevices' },
  { object: 'luci-rpc', method: 'getDHCPLeases' },
  { object: 'luci-rpc', method: 'getHostHints' },
  { object: 'luci-rpc', method: 'getWirelessDevices' },
  { object: 'luci', method: 'getFeatures' },
  { object: 'luci', method: 'getVersion' },
  { object: 'luci', method: 'getTempInfo' },
  { object: 'luci', method: 'getRealtimeStats', params: { mode: 'load' } },
  { object: 'iwinfo', method: 'devices' },
  { object: 'uci', method: 'get', params: { config: 'dhcp' } },
  { object: 'uci', method: 'get', params: { config: 'firewall' } },
  { object: 'uci', method: 'get', params: { config: 'wireless' } },
  { object: 'uci', method: 'get', params: { config: 'network' } },
  { object: 'uci', method: 'get', params: { config: 'system' } },
  { object: 'rc', method: 'list' },
  { object: 'log', method: 'read', params: { lines: 200, oneshot: true } },
  { object: 'file', method: 'read', params: { path: '/proc/stat' } },
  { object: 'file', method: 'list', params: { path: '/sys/class/thermal' } },
  { object: 'file', method: 'list', params: { path: '/sys/devices/system/cpu' } },
  { object: 'file', method: 'stat', params: { path: '/usr/bin/etherwake' } },
  exec('/bin/dmesg', ['-r']),
  exec('/sbin/ip', ['-4', 'neigh', 'show']),
  exec('/usr/libexec/syslog-wrapper'),
  access('ubus', 'luci-rpc', 'getDHCPLeases'),
  access('ubus', 'hostapd.*', 'del_client'),
  access('ubus', 'iwinfo', 'scan'),
  access('ubus', 'iwinfo', 'assoclist'),
  access('ubus', 'rc', 'list'),
  access('ubus', 'rc', 'init'),
  access('ubus', 'luci', 'getTempInfo'),
  access('file', '/usr/bin/etherwake', 'exec'),
  access('file', '/sbin/ip -4 neigh show', 'exec'),
  access('file', '/usr/libexec/syslog-wrapper', 'exec'),
  access('file', '/bin/dmesg -r', 'exec'),
  access('file', '/sbin/ifup', 'exec'),
  access('file', '/sbin/ifdown', 'exec'),
  access('file', '/sbin/reboot', 'exec'),
  // OpenWrt 23.05 fallbacks (services through LuCI, syslog through logread).
  { object: 'luci', method: 'getInitList' },
  exec('/sbin/logread', ['-e', '^']),
  access('ubus', 'luci', 'getInitList'),
  access('ubus', 'luci', 'setInitAction'),
  access('file', '/sbin/logread -e ^', 'exec'),
  // 25.12: Wake-on-LAN through LuCI's own object.
  access('ubus', 'luci.wol', 'exec'),
  // Radio capabilities and stations (QEMU's hwsim radios; empty on routers without Wi-Fi).
  { object: 'iwinfo', method: 'info', params: { device: 'radio0' } },
  { object: 'iwinfo', method: 'freqlist', params: { device: 'radio0' } },
  { object: 'iwinfo', method: 'txpowerlist', params: { device: 'radio0' } },
  { object: 'iwinfo', method: 'assoclist', params: { device: 'phy0-ap0' } },
  { object: 'iwinfo', method: 'scan', params: { device: 'phy0-ap0' } },
  // Package management through LuCI's helper (services/packages.ts detectPackageEnv).
  { object: 'file', method: 'stat', params: { path: '/usr/libexec/package-manager-call' } },
  { object: 'file', method: 'stat', params: { path: '/usr/libexec/opkg-call' } },
  { object: 'file', method: 'stat', params: { path: '/usr/bin/apk' } },
  { object: 'file', method: 'read', params: { path: '/etc/opkg/distfeeds.conf' } },
  { object: 'file', method: 'read', params: { path: '/etc/apk/repositories.d/distfeeds.list' } },
  { object: 'file', method: 'list', params: { path: '/var/opkg-lists' } },
  { object: 'file', method: 'list', params: { path: '/var/cache/apk' } },
  access('file', '/usr/libexec/package-manager-call install /tmp/upload.ipk', 'exec'),
  access('file', '/usr/libexec/package-manager-call install /tmp/upload.apk', 'exec'),
  access('file', '/usr/libexec/opkg-call install /tmp/upload.ipk', 'exec'),
  // M2: processes, connections, routes, cron, LEDs, time, WireGuard, installed packages.
  { object: 'luci', method: 'getProcessList' },
  { object: 'luci', method: 'getConntrackList' },
  { object: 'luci', method: 'getLEDs' },
  { object: 'luci', method: 'getTimezones' },
  { object: 'luci', method: 'getLocaltime' },
  { object: 'luci.wireguard', method: 'getWgInstances' },
  exec('/sbin/ip', ['-4', 'route', 'show', 'table', 'all']),
  exec('/sbin/ip', ['-6', 'route', 'show', 'table', 'all']),
  { object: 'file', method: 'read', params: { path: '/etc/crontabs/root' } },
  exec('/usr/libexec/package-manager-call', ['list-installed']),
  exec('/usr/libexec/opkg-call', ['list-installed']),
  access('ubus', 'luci', 'getProcessList'),
  access('ubus', 'luci', 'getConntrackList'),
  access('ubus', 'network.rrdns', 'lookup'),
  access('ubus', 'luci', 'getLEDs'),
  access('ubus', 'luci', 'setPassword'),
  access('ubus', 'luci', 'setLocaltime'),
  access('ubus', 'luci.wireguard', 'getWgInstances'),
  access('file', '/bin/kill', 'exec'),
  access('file', '/sbin/ip -4 route show table all', 'exec'),
  access('file', '/etc/crontabs/root', 'write'),
  access('file', '/etc/init.d/cron reload', 'exec'),
];

/** Calls that take longer than the default timeout. */
const SLOW: Record<string, number> = { 'iwinfo.scan': 25_000 };

/**
 * The router plugin (`routelink` ubus object, `--agent`): fixed windows relative to now — the last hour and
 * today — and one device, the one with the most traffic today.
 */
export function agentCalls(now: number, mac?: string): UbusCall[] {
  const end = Math.floor(now / 1000);
  const hour = { start: end - 3600, end };
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = { start: Math.floor(midnight.getTime() / 1000), end };
  const rl = (method: string, params?: Record<string, unknown>): UbusCall => ({ object: 'routelink', method, params });
  return [
    { object: 'file', method: 'stat', params: { path: '/usr/sbin/routelinkd' } },
    rl('info'),
    rl('devices'),
    rl('live'),
    rl('history', hour),
    rl('history', { ...today, class: 'wan' }),
    rl('summary', today),
    rl('summary', { ...today, class: 'lan' }),
    rl('events', { start: end - 86400, end }),
    ...(mac ? [rl('history', { ...hour, mac }), rl('events', { start: end - 86400, end, mac })] : []),
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const agent = args.includes('--agent');
  const set = args.find((a) => !a.startsWith('--'));
  const url = process.env.ROUTER_URL;
  if (!set || !url) throw new Error('usage: ROUTER_URL=... ROUTER_PASSWORD=... record-fixtures.ts <set> [--agent]');

  const session = new UbusSession(
    { http: nodeHttpClient, baseUrl: url },
    { username: process.env.ROUTER_USER ?? 'root', password: process.env.ROUTER_PASSWORD ?? '' },
  );
  const dir = join(__dirname, '..', 'test', 'fixtures', set);
  mkdirSync(dir, { recursive: true });

  let calls = CALLS;
  if (agent) {
    const devices = await session.call<{ devices: { mac: string; today_rx: number; today_tx: number }[] }>(
      'routelink',
      'devices',
    );
    const busiest = [...devices.devices].sort((a, b) => b.today_rx + b.today_tx - (a.today_rx + a.today_tx))[0];
    calls = agentCalls(Date.now(), busiest?.mac);
  }
  for (const call of calls) {
    const [result] = await session.batch([call], { timeoutMs: SLOW[`${call.object}.${call.method}`] });
    const name = fixtureName(call);
    const content = result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.code };
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(content, null, 2) + '\n');
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${name}${result.ok ? '' : ` (${result.error.code})`}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
