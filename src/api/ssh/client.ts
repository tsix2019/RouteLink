import RouteLinkNative, {
  type SshExecResult,
  type SshHostKey,
  type SshKeyPair,
  type SshOptions,
} from 'routelink-native';

import { bytesToBase64 } from '../../utils/base64';
import { toNativeError } from '../http/errors';

/** SSH through the native module (design §17): sshj on Android, Citadel on iOS. */

export interface TerminalHandlers {
  /** Output as base64; a chunk may end inside a UTF-8 sequence (xterm puts them back together). */
  onData(data: string): void;
  /** The shell ended by itself; error is set when the connection broke. Not called after close(). */
  onClose(error?: string): void;
}

export interface SshTerminal {
  readonly id: string;
  /** Keyboard input. */
  send(text: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  close(): Promise<void>;
}

type Early = { at: number; events: ({ data: string } | { closed: string | undefined })[] };

const handlers = new Map<string, TerminalHandlers>();
/** Events of sessions whose id sshOpen has not handed back yet: the prompt can arrive first. */
const early = new Map<string, Early>();
let subscribed = false;

function hold(id: string, event: Early['events'][number]) {
  const now = Date.now();
  for (const [key, entry] of early) if (now - entry.at > 60_000) early.delete(key);
  const entry = early.get(id) ?? { at: now, events: [] };
  if (entry.events.length < 512) entry.events.push(event);
  early.set(id, entry);
}

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  RouteLinkNative.addListener('onSshData', ({ id, data }) => {
    const h = handlers.get(id);
    if (h) h.onData(data);
    else hold(id, { data });
  });
  RouteLinkNative.addListener('onSshClosed', ({ id, error }) => {
    const h = handlers.get(id);
    if (!h) return hold(id, { closed: error ?? undefined });
    handlers.delete(id);
    h.onClose(error ?? undefined);
  });
}

const native = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    throw toNativeError(error);
  }
};

/** An interactive shell with a PTY. The host key must already be pinned (readHostKey on the first connection). */
export async function openTerminal(options: SshOptions, h: TerminalHandlers): Promise<SshTerminal> {
  subscribe();
  const id = await native(() => RouteLinkNative.sshOpen(options));
  handlers.set(id, h);
  const before = early.get(id);
  early.delete(id);
  for (const event of before?.events ?? []) {
    if ('data' in event) h.onData(event.data);
    else {
      handlers.delete(id);
      h.onClose(event.closed);
    }
  }
  const encoder = new TextEncoder();
  return {
    id,
    send: (text) => native(() => RouteLinkNative.sshWrite(id, bytesToBase64(encoder.encode(text)))),
    resize: (cols, rows) => native(() => RouteLinkNative.sshResize(id, cols, rows)),
    close: () => {
      handlers.delete(id);
      return native(() => RouteLinkNative.sshClose(id));
    },
  };
}

/** Connects only far enough to read the server's key, for the user to confirm before pinning it. */
export function readHostKey(host: string, port: number, timeoutMs = 10_000): Promise<SshHostKey> {
  return native(() => RouteLinkNative.sshHostKey(host, port, timeoutMs));
}

/** A one-off command on a connection of its own (design §17: for what ubus does not allow). */
export function runCommand(options: SshOptions, command: string, timeoutMs = 30_000): Promise<SshExecResult> {
  return native(() => RouteLinkNative.sshExec(options, command, timeoutMs));
}

export function generateKeyPair(comment: string): Promise<SshKeyPair> {
  return native(() => RouteLinkNative.sshGenerateKey(comment));
}

export function publicKeyOf(seed: string, comment: string): Promise<string> {
  return native(() => RouteLinkNative.sshPublicKey(seed, comment));
}
