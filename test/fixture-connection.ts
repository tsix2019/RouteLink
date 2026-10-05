import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RouterConnection } from '../src/api/connection/types';
import { UbusError, type UbusErrorCode } from '../src/api/ubus/errors';
import { callKey, type UbusCall, type UbusResult } from '../src/api/ubus/types';
import { fixtureName } from './fixture-names';

type Override = UbusResult | ((call: UbusCall) => UbusResult);

export const ok = <T>(data: T): UbusResult<T> => ({ ok: true, data });

/** Reads one recorded result, e.g. loadFixture('handmade', 'iwinfo.assoclist.phy0-ap0'). */
export function loadFixture(set: string, name: string): UbusResult {
  const stored = JSON.parse(readFileSync(join(__dirname, 'fixtures', set, `${name}.json`), 'utf8')) as {
    ok: boolean;
    data?: unknown;
    error?: UbusErrorCode;
  };
  return stored.ok ? { ok: true, data: stored.data } : { ok: false, error: new UbusError(stored.error!, name) };
}
export const fail = (code: UbusErrorCode, call = 'x.y'): UbusResult => ({
  ok: false,
  error: new UbusError(code, call),
});

/**
 * RouterConnection that answers from recorded fixtures (test/fixtures/<set>/<fixtureName>.json).
 * Individual calls can be overridden per test; unknown calls answer METHOD_NOT_FOUND.
 */
export class FixtureConnection implements RouterConnection {
  readonly kind = 'live' as const;
  readonly routerId = 'fixture';
  readonly calls: UbusCall[] = [];
  private readonly overrides = new Map<string, Override>();

  constructor(private readonly set = 'openwrt-24.10') {}

  /** Key is a fixture name ("uci.get.dhcp") or a call key ("system.board"). */
  override(key: string, result: Override): this {
    this.overrides.set(key, result);
    return this;
  }

  async call<T>(object: string, method: string, params?: Record<string, unknown>): Promise<T> {
    const [r] = await this.batch([{ object, method, params }]);
    if (!r.ok) throw r.error;
    return r.data as T;
  }

  async batch(calls: UbusCall[]): Promise<UbusResult[]> {
    return calls.map((c) => this.resolve(c));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  /** Commands run through cgi-exec, in order. */
  readonly execs: string[][] = [];
  private execHandler?: (argv: string[]) => string | Promise<string>;

  /** Answers cgiExec calls; without a handler cgiExec rejects like a router without cgi-io. */
  onCgiExec(handler: (argv: string[]) => string | Promise<string>): this {
    this.execHandler = handler;
    return this;
  }

  async cgiExec(argv: string[]): Promise<string> {
    this.execs.push(argv);
    if (!this.execHandler) throw new UbusError('PERMISSION_DENIED', `cgi-exec ${argv[0]}`);
    return this.execHandler(argv);
  }

  private resolve(call: UbusCall): UbusResult {
    this.calls.push(call);
    const name = fixtureName(call);
    const override = this.overrides.get(name) ?? this.overrides.get(callKey(call));
    if (override) return typeof override === 'function' ? override(call) : override;

    const file = join(__dirname, 'fixtures', this.set, `${name}.json`);
    if (!existsSync(file))
      return { ok: false, error: new UbusError('METHOD_NOT_FOUND', callKey(call), `no fixture ${name}`) };
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { ok: boolean; data?: unknown; error?: UbusErrorCode };
    return stored.ok
      ? { ok: true, data: stored.data }
      : { ok: false, error: new UbusError(stored.error!, callKey(call)) };
  }
}
