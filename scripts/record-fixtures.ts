// Records real ubus responses as JSON fixtures for unit tests.
// Usage: ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npx tsx scripts/record-fixtures.ts <set>
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
];

/** Calls that take longer than the default timeout. */
const SLOW: Record<string, number> = { 'iwinfo.scan': 25_000 };

async function main() {
  const set = process.argv[2];
  const url = process.env.ROUTER_URL;
  if (!set || !url) throw new Error('usage: ROUTER_URL=... ROUTER_PASSWORD=... record-fixtures.ts <set>');

  const session = new UbusSession(
    { http: nodeHttpClient, baseUrl: url },
    { username: process.env.ROUTER_USER ?? 'root', password: process.env.ROUTER_PASSWORD ?? '' },
  );
  const dir = join(__dirname, '..', 'test', 'fixtures', set);
  mkdirSync(dir, { recursive: true });

  for (const call of CALLS) {
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
