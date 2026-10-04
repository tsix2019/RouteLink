// Redacted compatibility report for a real router. Prints counts and error codes only:
// no host names, IP or MAC addresses of your devices, no Wi-Fi names or keys.
//
//   read -rsp "Router password: " RL_PW && echo && RL_PW="$RL_PW" npx tsx scripts/router-check.ts http://192.168.1.1
//
// Add --insecure for HTTPS with a self-signed certificate (diagnostics only).
import { detectCapabilities } from '../src/api/capabilities';
import { LiveConnection } from '../src/api/connection/live';
import { classifyError } from '../src/api/connection/types';
import { nodeHttpClient } from '../src/api/http/node';
import { getClients } from '../src/api/services/clients';
import { kernelLog, systemLog } from '../src/api/services/logs';
import { getInterfaces, pickWan } from '../src/api/services/network';
import { listServices } from '../src/api/services/services';
import { getSystem, getTemperature } from '../src/api/services/system';
import { getRadios } from '../src/api/services/wireless';
import type { AuthMode } from '../src/api/ubus/login';

async function step<T>(label: string, run: () => Promise<T>, describe: (v: T) => string) {
  try {
    const value = await run();
    console.log(`  ✓ ${label}: ${describe(value)}`);
    return value;
  } catch (error) {
    const failure = classifyError(error);
    const code = (error as { code?: string }).code;
    console.log(`  ✗ ${label}: ${failure.kind}${code ? ` (${code})` : ''}`);
    return undefined;
  }
}

async function main() {
  const url = process.argv.find((a) => /^https?:\/\//.test(a) || /^\d+\.\d+\.\d+\.\d+/.test(a));
  if (!url) throw new Error('usage: RL_PW=... npx tsx scripts/router-check.ts http://192.168.1.1 [--insecure] [--user root]');
  if (process.argv.includes('--insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const userIndex = process.argv.indexOf('--user');
  const username = userIndex > 0 ? process.argv[userIndex + 1] : 'root';
  const password = process.env.RL_PW ?? process.env.ROUTER_PASSWORD;
  if (password === undefined) throw new Error('set RL_PW (see the command at the top of this file)');

  let mode: AuthMode | undefined;
  const conn = new LiveConnection({
    routerId: 'check',
    baseUrl: url,
    username,
    password,
    http: nodeHttpClient,
    onLogin: (s) => (mode = s.mode),
  });

  console.log('RouteLink router check (redacted)');
  const sys = await step('login + system', () => getSystem(conn), (s) =>
    `${s.distribution} ${s.version} · ${s.target} · model "${s.model}" · cores ${s.cpuCores ?? '?'} · login via ${mode}`);
  if (!sys) return;

  await step('temperature', () => getTemperature(conn), (t) => (t === null ? 'not available' : `${t} °C`));
  await step('capabilities', () => detectCapabilities(conn), (caps) =>
    Object.entries(caps)
      .map(([f, c]) => `${f}=${c.status === 'missing-package' ? `missing(${c.packages.join('+')})` : c.status}`)
      .join(', '));
  await step('interfaces', () => getInterfaces(conn), (ifs) =>
    `${ifs.length} [${ifs.map((i) => `${i.name}:${i.proto}:${i.up ? 'up' : 'down'}`).join(' ')}] wan=${pickWan(ifs)?.name ?? 'none'}`);
  await step('clients', () => getClients(conn), (cs) =>
    `${cs.length} total, ${cs.filter((c) => c.online).length} online, ${cs.filter((c) => c.connection === 'wifi').length} wifi, ` +
    `${cs.filter((c) => c.connection === 'wired').length} wired, ${cs.filter((c) => c.isStatic).length} static, ` +
    `online via ${[...new Set(cs.map((c) => c.onlineSource))].join('/')}`);
  await step('radios', () => getRadios(conn), (rs) =>
    `${rs.length} [${rs.map((r) => `${r.band} ch${r.channel} ${r.up ? 'up' : 'down'} nets=${r.networks.length}`).join(', ')}]`);
  await step('services', () => listServices(conn), (s) => `${s.length} (${s.filter((x) => x.running).length} running)`);
  await step('system log', () => systemLog(conn), (l) => `${l.length} lines`);
  await step('kernel log', () => kernelLog(conn), (l) => `${l.length} lines`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
