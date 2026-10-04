// Records real ubus responses as JSON fixtures for unit tests.
// Usage: ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npx tsx scripts/record-fixtures.ts <label>
// Only run against disposable routers (Docker/QEMU): fixtures are committed to a public repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { nodeHttpClient } from '../src/api/http/node';
import { UbusSession } from '../src/api/ubus/session';
import type { UbusCall } from '../src/api/ubus/types';

interface Recording extends UbusCall {
  tag?: string;
}

const CALLS: Recording[] = [
  { object: 'system', method: 'board' },
  { object: 'system', method: 'info' },
  { object: 'network.interface', method: 'dump' },
  { object: 'network.device', method: 'status' },
  { object: 'luci-rpc', method: 'getNetworkDevices' },
  { object: 'luci-rpc', method: 'getDHCPLeases' },
  { object: 'luci-rpc', method: 'getHostHints' },
  { object: 'luci-rpc', method: 'getWirelessDevices' },
  { object: 'luci', method: 'getFeatures' },
  { object: 'iwinfo', method: 'devices' },
  { object: 'uci', method: 'get', params: { config: 'dhcp' }, tag: 'dhcp' },
  { object: 'uci', method: 'get', params: { config: 'firewall' }, tag: 'firewall' },
  { object: 'uci', method: 'get', params: { config: 'wireless' }, tag: 'wireless' },
  { object: 'uci', method: 'get', params: { config: 'network' }, tag: 'network' },
  { object: 'uci', method: 'get', params: { config: 'system' }, tag: 'system' },
  { object: 'rc', method: 'list' },
  { object: 'log', method: 'read', params: { lines: 200, oneshot: true } },
  { object: 'file', method: 'read', params: { path: '/proc/stat' }, tag: 'proc-stat' },
  { object: 'file', method: 'read', params: { path: '/proc/net/arp' }, tag: 'proc-net-arp' },
  { object: 'file', method: 'list', params: { path: '/sys/class/thermal' }, tag: 'thermal' },
  { object: 'file', method: 'stat', params: { path: '/usr/bin/etherwake' }, tag: 'etherwake' },
  { object: 'file', method: 'exec', params: { command: '/bin/dmesg', params: ['-r'] }, tag: 'dmesg' },
  { object: 'file', method: 'exec', params: { command: '/sbin/ip', params: ['-4', 'neigh', 'show'] }, tag: 'ip-neigh' },
  { object: 'file', method: 'exec', params: { command: '/sbin/logread', params: ['-l', '50'] }, tag: 'logread' },
  { object: 'file', method: 'exec', params: { command: '/usr/libexec/syslog-wrapper' }, tag: 'syslog-wrapper' },
  { object: 'file', method: 'list', params: { path: '/sys/devices/system/cpu' }, tag: 'cpu' },
  { object: 'luci', method: 'getRealtimeStats', params: { mode: 'interface', device: 'eth1' }, tag: 'interface' },
  { object: 'luci', method: 'getRealtimeStats', params: { mode: 'load' }, tag: 'load' },
  { object: 'luci', method: 'getTempInfo' },
  { object: 'luci', method: 'getVersion' },
  { object: 'session', method: 'access', params: { scope: 'ubus', object: 'luci-rpc', function: 'getDHCPLeases' }, tag: 'luci-rpc' },
  { object: 'session', method: 'access', params: { scope: 'ubus', object: 'hostapd.*', function: 'del_client' }, tag: 'hostapd' },
  { object: 'session', method: 'access', params: { scope: 'file', object: '/usr/bin/etherwake', function: 'exec' }, tag: 'file-etherwake' },
  { object: 'session', method: 'access', params: { scope: 'file', object: '/proc/stat', function: 'read' }, tag: 'file-proc-stat' },
];

async function main() {
  const label = process.argv[2];
  const url = process.env.ROUTER_URL;
  if (!label || !url) throw new Error('usage: ROUTER_URL=... ROUTER_PASSWORD=... record-fixtures.ts <label>');

  const session = new UbusSession(
    { http: nodeHttpClient, baseUrl: url },
    { username: process.env.ROUTER_USER ?? 'root', password: process.env.ROUTER_PASSWORD ?? '' },
  );
  const dir = join(__dirname, '..', 'test', 'fixtures', label);
  mkdirSync(dir, { recursive: true });

  for (const call of CALLS) {
    const [result] = await session.batch([{ object: call.object, method: call.method, params: call.params }]);
    const name = `${call.object}.${call.method}${call.tag ? `.${call.tag}` : ''}.json`;
    const content = result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.code };
    writeFileSync(join(dir, name), JSON.stringify(content, null, 2) + '\n');
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${name}${result.ok ? '' : ` (${result.error.code})`}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
