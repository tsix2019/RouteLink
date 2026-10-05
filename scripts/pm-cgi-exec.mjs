// Installs uploaded packages through /cgi-bin/cgi-exec (as LuCI's package page does) instead of the
// ubus "file exec" method, which hangs when a package's postinst reloads rpcd.
// Usage: node scripts/pm-cgi-exec.mjs <base url> <package files...>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [base, ...files] = process.argv.slice(2);
let id = 1;
let sid = '00000000000000000000000000000000';
async function call(object, method, params = {}) {
  const res = await fetch(`${base}/ubus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'call', params: [sid, object, method, params] }),
  });
  const body = await res.json();
  return body.result ?? [-1, body.error];
}
// cgi-exec takes the command line with spaces escaped by backslashes (see LuCI fs.exec_direct)
async function cgiExec(argv) {
  const cmd = argv.map((a) => a.replace(/\\/g, '\\\\').replace(/(\s)/g, '\\$1')).join(' ');
  const t0 = Date.now();
  const res = await fetch(`${base}/cgi-bin/cgi-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `sessionid=${encodeURIComponent(sid)}&command=${encodeURIComponent(cmd)}`,
    signal: AbortSignal.timeout(300000),
  });
  return { status: res.status, text: await res.text(), ms: Date.now() - t0 };
}

sid = (await call('session', 'login', { username: 'root', password: process.env.ROUTER_PASSWORD ?? 'routelink-test' }))[1]
  .ubus_rpc_session;
const apk = (await call('file', 'stat', { path: '/usr/bin/apk' }))[0] === 0;
const helper = (await call('file', 'stat', { path: '/usr/libexec/package-manager-call' }))[0] === 0
  ? '/usr/libexec/package-manager-call'
  : '/usr/libexec/opkg-call';
const upload = apk ? '/tmp/upload.apk' : '/tmp/upload.ipk';
for (const f of files) {
  const bytes = readFileSync(f);
  for (let off = 0; off < bytes.length; off += 32768)
    await call('file', 'write', { path: upload, data: bytes.subarray(off, off + 32768).toString('base64'), base64: true, append: off > 0 });
  const r = await cgiExec([helper, 'install', upload]);
  console.log(`cgi-exec install ${basename(f)}: HTTP ${r.status} in ${r.ms} ms: ${r.text.replace(/\s+/g, ' ').slice(0, 220)}`);
}
const info = await call('routelink', 'info');
console.log('routelink info:', info[0] === 0 ? `api ${info[1].api}` : info);
