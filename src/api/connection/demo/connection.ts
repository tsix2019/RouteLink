import { NativeError } from '../../http/errors';
import { UbusError } from '../../ubus/errors';
import type { CallOptions } from '../../ubus/session';
import { callKey, type UbusCall, type UbusResult } from '../../ubus/types';
import type { RouterConnection } from '../types';
import { demoPackageHelper } from './agent';
import { handlers, hostapdHandler } from './handlers';
import { createDemoState, tick, type DemoState } from './state';

export const DEMO_ROUTER_ID = 'demo';

/** A simulated OpenWrt router; writes mutate in-memory state and are lost on restart. */
export class DemoConnection implements RouterConnection {
  readonly kind = 'demo' as const;
  readonly routerId = DEMO_ROUTER_ID;
  readonly state: DemoState;

  constructor(
    seed = 2026,
    private readonly clock: () => number = Date.now,
    /** Package installs take a moment on a real router; tests pass 0. */
    private readonly cgiLatencyMs = 700,
  ) {
    this.state = createDemoState(seed, clock());
  }

  async call<T>(object: string, method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T> {
    const [r] = await this.batch([{ object, method, params }], options);
    if (!r.ok) throw r.error;
    return r.data as T;
  }

  async batch(calls: UbusCall[], _options?: CallOptions): Promise<UbusResult[]> {
    const now = this.clock();
    this.checkReboot(now);
    tick(this.state, now);
    return calls.map((call) => {
      const handler = handlers[callKey(call)] ?? hostapdHandler(call.object);
      if (!handler) return { ok: false, error: new UbusError('METHOD_NOT_FOUND', callKey(call)) };
      try {
        return { ok: true, data: handler(this.state, call.params ?? {}, now) };
      } catch (error) {
        if (error instanceof UbusError) return { ok: false, error };
        throw error;
      }
    });
  }

  /** The only command the app runs through cgi-exec is LuCI's package helper. */
  async cgiExec(argv: string[]): Promise<string> {
    if (this.cgiLatencyMs) await new Promise((resolve) => setTimeout(resolve, this.cgiLatencyMs));
    this.checkReboot(this.clock());
    if (argv[0] !== '/usr/libexec/package-manager-call') throw new UbusError('PERMISSION_DENIED', `cgi-exec ${argv[0]}`);
    return demoPackageHelper(this.state, argv);
  }

  async ping(): Promise<boolean> {
    return !this.state.rebootingUntil || this.state.rebootingUntil <= this.clock();
  }

  /** While "rebooting" every call fails like an unreachable router; afterwards uptime restarts. */
  private checkReboot(now: number) {
    const until = this.state.rebootingUntil;
    if (!until) return;
    if (now < until) throw new NativeError('ERR_UNREACHABLE', 'demo router is rebooting');
    this.state.rebootingUntil = undefined;
    this.state.bootTime = until;
    this.state.lastTick = now;
  }
}
