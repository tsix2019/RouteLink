// Redacted compatibility report for a real router. Prints counts and error codes only:
// no host names, IP or MAC addresses of your devices, no Wi-Fi names or keys.
//
//   npx tsx scripts/router-check.ts http://192.168.1.1
//
// The password is asked for with hidden input (or taken from RL_PW). Add --insecure for HTTPS with a
// self-signed certificate (diagnostics only), --user NAME for a non-root account.
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

const ENTER = new Set(['\r', '\n']);
const BACKSPACE = new Set(['\u007f', '\b']);
const CTRL_C = '\u0003';

/** Reads a line without echoing it (works in PowerShell, cmd and bash terminals). */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error('not a terminal: set RL_PW instead'));
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let input = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ENTER.has(ch)) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        }
        if (ch === CTRL_C) {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (BACKSPACE.has(ch)) input = input.slice(0, -1);
        else input += ch;
      }
    };
    stdin.on('data', onData);
  });
}

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
  if (!url) throw new Error('usage: npx tsx scripts/router-check.ts http://192.168.1.1 [--insecure] [--user root]');
  if (process.argv.includes('--insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const userIndex = process.argv.indexOf('--user');
  const username = userIndex > 0 ? process.argv[userIndex + 1] : 'root';
  const password = process.env.RL_PW ?? (await promptHidden(`Password for ${username}@${url}: `));

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

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
