import type { RouterConnection } from '@/api/connection/types';
import { stageAndApply, uci, type UciSection } from '@/api/uci';
import type { UbusCall } from '@/api/ubus/types';

/**
 * The speed-test server lives in the plugin's UCI (`routelink.speedtest.server`, plan §1.5): empty means
 * Cloudflare, anything else is a LibreSpeed base URL. The phone test uses the same setting.
 */

export function speedServerOf(values: Record<string, UciSection>): string {
  const v = values.speedtest?.server;
  return typeof v === 'string' ? v.trim() : '';
}

export async function readSpeedServer(conn: RouterConnection): Promise<string> {
  return speedServerOf(await uci.get(conn, 'routelink'));
}

/** http(s) URL with a host; empty is fine (Cloudflare). */
export function isValidServerUrl(s: string): boolean {
  const v = s.trim();
  if (!v) return true;
  return /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(v);
}

/** The named `speedtest` section is created when the plugin's default config lacks it. */
export function speedServerChanges(values: Record<string, UciSection>, server: string): UbusCall[] {
  const v = { server: server.trim() };
  return values.speedtest
    ? [uci.set('routelink', 'speedtest', v)]
    : [uci.add('routelink', 'speedtest', v, 'speedtest')];
}

/** "speed.example.com" for a LibreSpeed URL, for compact display. */
export function serverHost(server: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(server.trim());
  return m ? m[1] : server.trim();
}

/** Writes the setting straight away (the plugin's own config; nothing that could cut the router off). */
export async function saveSpeedServer(conn: RouterConnection, server: string): Promise<void> {
  const values = await uci.get(conn, 'routelink');
  await stageAndApply(conn, speedServerChanges(values, server), { mode: 'direct' });
}
