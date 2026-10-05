// Shared setup for integration tests against a real, disposable OpenWrt (Docker locally, QEMU in CI).
// ROUTER_URL=http://127.0.0.1:18080 ROUTER_PASSWORD=routelink-test npm run test:int
import { execFileSync } from 'node:child_process';

import { LiveConnection } from '../../src/api/connection/live';
import { nodeHttpClient } from '../../src/api/http/node';
import type { AuthMode, Session } from '../../src/api/ubus/login';

export const ROUTER_URL = process.env.ROUTER_URL ?? 'http://127.0.0.1:18080';
export const ROUTER_PASSWORD = process.env.ROUTER_PASSWORD ?? 'routelink-test';

export interface TestConnection {
  conn: LiveConnection;
  sessions: Session[];
}

let counter = 0;

/** A fresh connection (own login, own session) to the test router; `url` reaches it at another address. */
export function connect(o: { password?: string; authMode?: AuthMode; url?: string } = {}): TestConnection {
  const sessions: Session[] = [];
  const conn = new LiveConnection({
    routerId: `int-${++counter}`,
    baseUrl: o.url ?? ROUTER_URL,
    username: 'root',
    password: o.password ?? ROUTER_PASSWORD,
    authMode: o.authMode,
    http: nodeHttpClient,
    onLogin: (s) => sessions.push(s),
  });
  return { conn, sessions };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it returns true or `timeoutMs` passes. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, stepMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return true;
    } catch {
      // the router may be restarting a service
    }
    await sleep(stepMs);
  }
  return false;
}

/** SSH to the test router for checks the app has no permission for (QEMU in CI: ROUTER_SSH_PORT=18022). */
export const SSH_PORT = process.env.ROUTER_SSH_PORT;

export function routerShell(command: string, password = ROUTER_PASSWORD): string {
  if (!SSH_PORT) throw new Error('ROUTER_SSH_PORT is not set');
  return execFileSync(
    'sshpass',
    [
      '-p',
      password,
      'ssh',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'LogLevel=ERROR',
      '-o',
      'PubkeyAuthentication=no',
      '-p',
      SSH_PORT,
      'root@127.0.0.1',
      command,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
}
