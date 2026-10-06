import { useEffect, useRef, useState, type RefObject } from 'react';
import type { SshHostKey } from 'routelink-native';

import { NativeError } from '@/api/http/errors';
import { openTerminal, readHostKey, type SshTerminal, type TerminalHandlers } from '@/api/ssh/client';
import { useRouters, type RouterProfile } from '@/state/routers';

import { appKey } from './appKey';
import { openDemoShell } from './demoShell';

export type SessionState =
  | { step: 'connecting' }
  /** First connection (no pin) or a key that changed (previous is the old pin): the user decides. */
  | { step: 'confirm-host'; key: SshHostKey; previous?: string }
  /** The router password is not saved, or was refused. */
  | { step: 'password'; refused: boolean }
  | { step: 'connected' }
  | { step: 'closed'; code?: string; error?: string };

export interface TerminalOutput {
  write(data: string): void;
  print(text: string): void;
}

/** Where SSH goes: the router's host on port 22 (or the saved port), as root unless set otherwise. */
export function sshTarget(profile: Pick<RouterProfile, 'baseUrl' | 'sshPort' | 'sshUser'>) {
  const host = new URL(profile.baseUrl).hostname.replace(/^\[|\]$/g, '');
  return { host, port: profile.sshPort ?? 22, user: profile.sshUser ?? 'root' };
}

/**
 * One SSH shell for the terminal page (design §17): host key confirmation on first use, the router password or
 * the app key, reconnecting after a drop. In demo mode a canned shell answers instead.
 */
export function useTerminalSession(o: {
  routerId: string | undefined;
  demo: boolean;
  output: RefObject<TerminalOutput | null>;
  /** The terminal's current size, for the PTY. */
  size: RefObject<{ cols: number; rows: number }>;
  /** Printed into the terminal when the connection ends by itself. */
  closedLine: string;
}) {
  const [state, setState] = useState<SessionState>({ step: 'connecting' });
  const terminal = useRef<SshTerminal | null>(null);
  const typedPassword = useRef<string | null>(null);
  const { routerId, demo, output, size, closedLine } = o;

  const handlers: TerminalHandlers = {
    onData: (data) => output.current?.write(data),
    onClose: (error) => {
      terminal.current = null;
      output.current?.print(`\r\n\x1b[2m${closedLine}\x1b[0m\r\n`);
      setState({ step: 'closed', error });
    },
  };

  const start = async (pin?: string) => {
    setState({ step: 'connecting' });
    if (demo) {
      terminal.current = openDemoShell(handlers);
      setState({ step: 'connected' });
      return;
    }
    const profile = useRouters.getState().routers.find((r) => r.id === routerId);
    if (!profile) return setState({ step: 'closed' });
    const { host, port, user } = sshTarget(profile);
    const hostKey = pin ?? profile.sshHostKey;
    try {
      if (!hostKey) {
        setState({ step: 'confirm-host', key: await readHostKey(host, port) });
        return;
      }
      let credentials: { keySeed: string } | { password: string };
      if (profile.sshAuth === 'key') {
        credentials = { keySeed: (await appKey()).seed };
      } else {
        const password = typedPassword.current ?? (await useRouters.getState().getPassword(profile.id));
        if (password === null) return setState({ step: 'password', refused: false });
        credentials = { password };
      }
      const { cols, rows } = size.current;
      terminal.current = await openTerminal(
        { host, port, username: user, hostKey, cols, rows, ...credentials },
        handlers,
      );
      setState({ step: 'connected' });
    } catch (error) {
      const code = error instanceof NativeError ? error.code : undefined;
      if (code === 'SSH_HOST_KEY_CHANGED') {
        const key = await readHostKey(host, port).catch(() => null);
        if (key) return setState({ step: 'confirm-host', key, previous: hostKey });
      }
      if (code === 'SSH_AUTH_FAILED' && profile.sshAuth !== 'key') {
        typedPassword.current = null;
        return setState({ step: 'password', refused: true });
      }
      setState({ step: 'closed', code, error: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(
    () => () => {
      void terminal.current?.close();
      terminal.current = null;
    },
    [],
  );

  return {
    state,
    /** First connection once the terminal knows its size, and reconnecting after a drop. */
    connect: () => void start(),
    /** Pins the shown key and connects with it. */
    trustHostKey: async (key: SshHostKey) => {
      if (routerId) await useRouters.getState().update(routerId, { sshHostKey: key.fingerprint });
      void start(key.fingerprint);
    },
    /** For this connection only; the saved router password is not changed. */
    usePassword: (password: string) => {
      typedPassword.current = password;
      void start();
    },
    cancel: () => setState({ step: 'closed' }),
    send: (data: string) => void terminal.current?.send(data).catch(() => undefined),
    resize: (cols: number, rows: number) => void terminal.current?.resize(cols, rows).catch(() => undefined),
    disconnect: () => {
      const t = terminal.current;
      terminal.current = null;
      void t?.close();
      setState({ step: 'closed' });
    },
  };
}
