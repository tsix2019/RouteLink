import type { SshOptions } from 'routelink-native';

import { sshChecks, type SshApi } from './ssh';

const FP = 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfG';
const err = (code: string) => Object.assign(new Error(code), { code });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const text = (s: string) => Buffer.from(s, 'base64').toString('utf8');
const params = { host: '127.0.0.1', port: 2222, fp: FP, user: 'root', password: 'routelink-test' };

/** Behaves like the CI's SSH server behind a correct native module. */
function goodSsh(): SshApi & { authorized: string[] } {
  const listeners = new Set<(e: { id: string; data: string }) => void>();
  const emit = (id: string, s: string) => setTimeout(() => listeners.forEach((l) => l({ id, data: b64(s) })), 1);
  const authorized: string[] = [];
  let size = '24 80';
  const login = (o: SshOptions) => {
    if (o.hostKey !== FP) throw err('SSH_HOST_KEY_CHANGED');
    const keyOk = o.keySeed === 'c2VlZA==' && authorized.includes('ssh-ed25519 AAAAkey routelink-selftest');
    if (!keyOk && o.password !== 'routelink-test') throw err('SSH_AUTH_FAILED');
  };
  return {
    authorized,
    httpRequest: async (o) => {
      authorized.push(String(o.body));
      return { status: 204, headers: {}, body: '' };
    },
    sshGenerateKey: async (comment) => ({ seed: 'c2VlZA==', publicKey: `ssh-ed25519 AAAAkey ${comment}` }),
    sshHostKey: async () => ({ type: 'ssh-ed25519', fingerprint: FP }),
    sshExec: async (o, command) => {
      login(o);
      if (command.startsWith('exit ')) return { code: Number(command.slice(5)), stdout: '', stderr: '' };
      return { code: 0, stdout: `${command.slice(5)}\n`, stderr: '' };
    },
    sshOpen: async (o) => {
      login(o);
      emit('pty', 'root@selftest:~# ');
      return 'pty';
    },
    sshWrite: async (id, data) => {
      const line = text(data).replace(/\r$/, '');
      emit(id, `${line}\r\n${line === 'stty size' ? size : line.slice(5)}\r\nroot@selftest:~# `);
    },
    sshResize: async (_id, cols, rows) => {
      size = `${rows} ${cols}`;
    },
    sshClose: async () => undefined,
    addListener: (_name, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

const run = async (api: SshApi, p = params) => {
  const out: { name: string; problem?: string }[] = [];
  for (const [name, check] of sshChecks(api, p)) out.push({ name, problem: await check() });
  return out;
};

it('passes every SSH check against a correct module and server', async () => {
  const api = goodSsh();
  const results = await run(api, { ...params, authorize: 'http://127.0.0.1:8097/authorize' } as typeof params);
  expect(results.filter((r) => r.problem)).toEqual([]);
  expect(results.map((r) => r.name)).toEqual([
    'ssh-host-key',
    'ssh-pin-mismatch',
    'ssh-wrong-password',
    'ssh-exec',
    'ssh-exit-code',
    'ssh-pty',
    'ssh-key-login',
  ]);
  expect(api.authorized).toEqual(['ssh-ed25519 AAAAkey routelink-selftest']);
});

it('fails when a changed host key is accepted', async () => {
  const api = goodSsh();
  const exec = api.sshExec;
  api.sshExec = (o, c) => exec({ ...o, hostKey: FP }, c);
  const failed = (await run(api)).filter((r) => r.problem);
  expect(failed.map((r) => r.name)).toEqual(['ssh-pin-mismatch']);
});

it('fails when the terminal size does not reach the server', async () => {
  const api = goodSsh();
  api.sshResize = async () => undefined;
  const failed = (await run(api)).filter((r) => r.problem);
  expect(failed.map((r) => r.name)).toEqual(['ssh-pty']);
  expect(failed[0].problem).toMatch(/^no resize/);
}, 15_000);
