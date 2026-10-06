import type {
  HttpRequestOptions,
  HttpResponse,
  SshExecResult,
  SshHostKey,
  SshKeyPair,
  SshOptions,
} from 'routelink-native';

import { base64ToBytes, bytesToBase64 } from '@/utils/base64';

/** The native SSH surface under test. */
export interface SshApi {
  httpRequest(options: HttpRequestOptions): Promise<HttpResponse>;
  sshGenerateKey(comment: string): Promise<SshKeyPair>;
  sshHostKey(host: string, port: number, timeoutMs?: number): Promise<SshHostKey>;
  sshOpen(options: SshOptions): Promise<string>;
  sshWrite(id: string, data: string): Promise<void>;
  sshResize(id: string, cols: number, rows: number): Promise<void>;
  sshClose(id: string): Promise<void>;
  sshExec(options: SshOptions, command: string, timeoutMs?: number): Promise<SshExecResult>;
  addListener(name: 'onSshData', listener: (event: { id: string; data: string }) => void): { remove(): void };
}

export interface SshParams {
  host: string;
  port: number;
  /** The server's host key as OpenSSH prints it ("SHA256:…"). */
  fp: string;
  user: string;
  password: string;
  /** POST a public key line here to have the server accept it (CI only). */
  authorize?: string;
}

type Check = [string, () => Promise<string | undefined>];

const codeOf = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? '');

async function expectCode(promise: Promise<unknown>, code: string): Promise<string | undefined> {
  try {
    await promise;
    return `resolved, expected ${code}`;
  } catch (error) {
    return codeOf(error) === code ? undefined : `got ${codeOf(error) || String(error)}, expected ${code}`;
  }
}

const utf8 = (text: string) => bytesToBase64(new TextEncoder().encode(text));

/** Collects a shell's output until `seen` matches, or gives up. */
function output(api: SshApi) {
  let text = '';
  let id = '';
  const decoder = new TextDecoder();
  const waiters: (() => void)[] = [];
  const sub = api.addListener('onSshData', (e) => {
    if (id && e.id !== id) return;
    text += decoder.decode(base64ToBytes(e.data), { stream: true });
    waiters.splice(0).forEach((w) => w());
  });
  return {
    track: (sessionId: string) => {
      id = sessionId;
    },
    text: () => text,
    async until(seen: (text: string) => boolean, ms = 8_000): Promise<boolean> {
      const end = Date.now() + ms;
      while (!seen(text)) {
        const left = end - Date.now();
        if (left <= 0) return false;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(left, 500));
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      return true;
    },
    stop: () => sub.remove(),
  };
}

/**
 * SSH checks (M4 T3) against the CI's server, set up like OpenWrt's dropbear (no AES-GCM): host key reading and
 * pinning, password and key logins, exit codes, and a PTY that echoes, resizes and closes.
 */
export function sshChecks(api: SshApi, p: SshParams): Check[] {
  const base: SshOptions = { host: p.host, port: p.port, username: p.user, password: p.password, hostKey: p.fp };
  const wrongFp = p.fp.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const checks: Check[] = [
    [
      'ssh-host-key',
      async () => {
        const key = await api.sshHostKey(p.host, p.port);
        return key.fingerprint === p.fp ? undefined : `${key.type} ${key.fingerprint}`;
      },
    ],
    [
      'ssh-pin-mismatch',
      () => expectCode(api.sshExec({ ...base, hostKey: wrongFp }, 'echo x'), 'SSH_HOST_KEY_CHANGED'),
    ],
    ['ssh-wrong-password', () => expectCode(api.sshExec({ ...base, password: 'wrong' }, 'echo x'), 'SSH_AUTH_FAILED')],
    [
      'ssh-exec',
      async () => {
        const r = await api.sshExec(base, 'echo routelink');
        return r.code === 0 && r.stdout === 'routelink\n' ? undefined : JSON.stringify(r);
      },
    ],
    [
      'ssh-exit-code',
      async () => {
        const r = await api.sshExec(base, 'exit 3');
        return r.code === 3 ? undefined : JSON.stringify(r);
      },
    ],
    [
      'ssh-pty',
      async () => {
        const out = output(api);
        let id = '';
        try {
          id = await api.sshOpen({ ...base, cols: 80, rows: 24 });
          out.track(id);
          if (!(await out.until((t) => t.includes('#')))) return `no prompt: ${JSON.stringify(out.text())}`;
          await api.sshWrite(id, utf8('echo pty-ok\r'));
          if (!(await out.until((t) => /pty-ok\r?\n/.test(t)))) return `no echo: ${JSON.stringify(out.text())}`;
          await api.sshResize(id, 100, 30);
          await api.sshWrite(id, utf8('stty size\r'));
          if (!(await out.until((t) => t.includes('30 100')))) return `no resize: ${JSON.stringify(out.text())}`;
          return undefined;
        } finally {
          out.stop();
          if (id) await api.sshClose(id);
        }
      },
    ],
  ];
  if (p.authorize) {
    const authorize = p.authorize;
    checks.push([
      'ssh-key-login',
      async () => {
        const key = await api.sshGenerateKey('routelink-selftest');
        if (!/^ssh-ed25519 [A-Za-z0-9+/]+=* routelink-selftest$/.test(key.publicKey)) return key.publicKey;
        const posted = await api.httpRequest({ url: authorize, method: 'POST', body: key.publicKey });
        if (posted.status !== 204) return `authorize: HTTP ${posted.status}`;
        const r = await api.sshExec({ ...base, password: undefined, keySeed: key.seed }, 'echo key');
        return r.code === 0 && r.stdout === 'key\n' ? undefined : JSON.stringify(r);
      },
    ]);
  }
  return checks;
}
