// What the app's one-tap install can do through LuCI's package-manager permissions (T28 of the P1 plan).
// Usage: node scripts/pm-check.mjs <base url> <package files...>
//   e.g. node scripts/pm-check.mjs http://127.0.0.1:18380 out/routelinkd_0.1.0-r1_x86_64.ipk
// Uses only a root session over /ubus, like the app. Prints one line per check.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [base, ...files] = process.argv.slice(2);
const password = process.env.ROUTER_PASSWORD ?? 'routelink-test';
const apkKey = join(import.meta.dirname, '..', 'openwrt', 'feed', 'keys', 'routelink-apk.pem');
let id = 1;
let sid = '00000000000000000000000000000000';

async function call(object, method, params = {}, timeoutMs = 90000) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/ubus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'call', params: [sid, object, method, params] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json();
    const ms = Date.now() - t0;
    if (body.error) return { ok: false, error: body.error.message, ms };
    const [code, data] = body.result;
    return { ok: code === 0, code, data, ms };
  } catch (e) {
    return { ok: false, error: String(e.message), ms: Date.now() - t0 };
  }
}

const log = (name, value) => console.log(`${name.padEnd(46)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await call('session', 'login', { username: 'root', password });
sid = login.data.ubus_rpc_session;
const board = await call('system', 'board');
log('release', `${board.data.release.version} ${board.data.release.target}`);

const apk = (await call('file', 'stat', { path: '/usr/bin/apk' })).ok;
const helper = (await call('file', 'stat', { path: '/usr/libexec/package-manager-call' })).ok
  ? '/usr/libexec/package-manager-call'
  : '/usr/libexec/opkg-call';
const upload = apk ? '/tmp/upload.apk' : '/tmp/upload.ipk';
log('helper / upload path', `${helper} ${upload}`);

const access = async (scope, object, fn) => (await call('session', 'access', { scope, object, function: fn })).data?.access;
for (const [scope, object, fn] of [
  ['file', `${helper} install /tmp/upload.ipk`, 'exec'],
  ['file', `${helper} update`, 'exec'],
  ['file', `${helper} update -q`, 'exec'],
  ['file', `${helper} remove routelinkd`, 'exec'],
  ['file', upload, 'write'],
  ['file', '/etc/os-release', 'read'],
  ['file', '/etc/opkg/distfeeds.conf', 'read'],
  ['file', '/etc/apk/repositories.d/distfeeds.list', 'read'],
  ['file', '/etc/opkg/customfeeds.conf', 'write'],
  ['file', '/etc/opkg/keys/a276fe73982c5f59', 'write'],
  ['file', '/etc/apk/repositories.d/customfeeds.list', 'write'],
  ['file', '/etc/apk/keys/routelink.pem', 'write'],
]) {
  log(`access ${scope} ${object} ${fn}`, await access(scope, object, fn));
}

// Architecture from the distribution feed URLs: .../packages/<arch>/base
const feeds = await call('file', 'read', { path: apk ? '/etc/apk/repositories.d/distfeeds.list' : '/etc/opkg/distfeeds.conf' });
log('architecture (distfeeds)', /\/packages\/([^/\s]+)\/base/.exec(feeds.data?.data ?? '')?.[1] ?? `unknown (${feeds.error ?? feeds.code})`);

// file write: base64 + append in 32 KB chunks (48 KB as base64 exceeds uhttpd's 64 KB request limit)
const chunk = 32 * 1024;
async function upload_(bytes) {
  for (let off = 0; off < bytes.length; off += chunk) {
    const r = await call('file', 'write', {
      path: upload,
      data: bytes.subarray(off, off + chunk).toString('base64'),
      base64: true,
      append: off > 0,
    });
    if (!r.ok) return r;
  }
  return call('file', 'stat', { path: upload });
}
const blob = randomBytes(300 * 1024);
const st = await upload_(blob);
log('file write base64+append (300 KB)', st.data?.size === blob.length ? 'ok (size matches)' : st);

if (apk) {
  // apk refuses unsigned local packages and the helper drops --allow-untrusted: trust our key instead
  const key = readFileSync(apkKey);
  const w = await call('file', 'write', { path: '/etc/apk/keys/routelink.pem', data: key.toString('base64'), base64: true });
  log('write /etc/apk/keys/routelink.pem', w.ok ? 'ok' : w);
}

// 23.05 grants only "opkg-call update *": a dash argument matches and opkg-call drops it
const updateParams = helper.endsWith('opkg-call') ? ['update', '-q'] : ['update'];
const update = await call('file', 'exec', { command: helper, params: updateParams }, 180000);
log('update', `${update.ok ? 'exit ' + update.data?.code : update.error ?? update.code} in ${update.ms} ms`);

for (const f of files) {
  await upload_(readFileSync(f));
  const r = await call('file', 'exec', { command: helper, params: ['install', upload] }, 180000);
  const out = r.data?.stdout ? JSON.parse(r.data.stdout) : r.data;
  log(`install ${basename(f)}`, `exec ${r.ok ? 'ok' : r.error ?? r.code} in ${r.ms} ms, helper code ${out?.code}: ${(out?.stderr ?? out?.stdout ?? '').split('\n').slice(-2).join(' | ').slice(0, 200)}`);
  if (!r.ok) {
    // the HTTP request gave up (uhttpd allows 60 s); the helper keeps running: wait for its lock to go away
    const t0 = Date.now();
    const lock = helper.endsWith('opkg-call') ? '/tmp/opkg.lock' : '/tmp/ipkg.lock';
    while (Date.now() - t0 < 300000 && (await call('file', 'stat', { path: lock })).ok) await sleep(3000);
    log('  helper finished after', `${Math.round((Date.now() - t0) / 1000)} s more`);
  }
}
const info = await call('routelink', 'info');
log('routelink info after install', info.ok ? `api ${info.data.api}, modules ${info.data.modules}` : info.error ?? info.code);
