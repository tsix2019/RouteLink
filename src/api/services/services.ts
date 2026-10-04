import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';

export interface Service {
  name: string;
  enabled: boolean;
  /** Undefined where the router can't tell (OpenWrt 23.05 lists init scripts without their state). */
  running?: boolean;
  /** Boot order; undefined for services without an init priority. */
  start?: number;
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';

/** Stopping or disabling these may cut the app off from the router. */
export const CRITICAL_SERVICES = ['network', 'firewall', 'dnsmasq', 'uhttpd', 'rpcd', 'dropbear', 'odhcpd', 'ubus'];

/** `rc` is missing or not granted (OpenWrt 23.05, where LuCI manages init scripts itself). */
const needsLuciFallback = (error: unknown) =>
  error instanceof UbusError && ['PERMISSION_DENIED', 'NOT_FOUND', 'METHOD_NOT_FOUND'].includes(error.code);

export async function listServices(conn: RouterConnection): Promise<Service[]> {
  try {
    const raw = await conn.call<Record<string, { enabled?: boolean; running?: boolean; start?: number }>>('rc', 'list');
    return Object.entries(raw)
      .map(([name, s]) => ({ name, enabled: !!s.enabled, running: !!s.running, start: s.start }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (!needsLuciFallback(error)) throw error;
    const raw = await conn.call<Record<string, { enabled?: boolean; index?: number }>>('luci', 'getInitList');
    return Object.entries(raw)
      .map(([name, s]) => ({ name, enabled: !!s.enabled, start: s.index }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export async function serviceAction(conn: RouterConnection, name: string, action: ServiceAction): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`invalid service name: ${name}`);
  try {
    await conn.call('rc', 'init', { name, action }, { timeoutMs: 30_000 });
  } catch (error) {
    if (!needsLuciFallback(error)) throw error;
    await conn.call('luci', 'setInitAction', { name, action }, { timeoutMs: 30_000 });
  }
}

export const isCritical = (name: string) => CRITICAL_SERVICES.includes(name);
