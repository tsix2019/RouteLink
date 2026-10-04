import type { RouterConnection } from '../connection/types';

export interface Service {
  name: string;
  enabled: boolean;
  running: boolean;
  /** Boot order; undefined for services without an init priority. */
  start?: number;
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';

/** Stopping or disabling these may cut the app off from the router. */
export const CRITICAL_SERVICES = ['network', 'firewall', 'dnsmasq', 'uhttpd', 'rpcd', 'dropbear', 'odhcpd', 'ubus'];

export async function listServices(conn: RouterConnection): Promise<Service[]> {
  const raw = await conn.call<Record<string, { enabled?: boolean; running?: boolean; start?: number }>>('rc', 'list');
  return Object.entries(raw)
    .map(([name, s]) => ({ name, enabled: !!s.enabled, running: !!s.running, start: s.start }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function serviceAction(conn: RouterConnection, name: string, action: ServiceAction): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`invalid service name: ${name}`);
  await conn.call('rc', 'init', { name, action }, { timeoutMs: 30_000 });
}

export const isCritical = (name: string) => CRITICAL_SERVICES.includes(name);
