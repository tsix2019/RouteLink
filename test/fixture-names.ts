import type { UbusCall } from '../src/api/ubus/types';

const slug = (s: string) =>
  s
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+$/, '')
    .toLowerCase();

/** File name (without .json) of the recorded response for a call. Shared by the recorder and FixtureConnection. */
export function fixtureName(call: UbusCall): string {
  const p = (call.params ?? {}) as Record<string, unknown>;
  const base = `${call.object}.${call.method}`;
  let tag = '';
  if (call.object === 'uci' && call.method === 'get') tag = String(p.config);
  else if (call.object === 'file') {
    const args = Array.isArray(p.params) ? ` ${(p.params as string[]).join(' ')}` : '';
    tag = slug(`${String(p.command ?? p.path)}${args}`);
  } else if (call.object === 'session' && call.method === 'access') tag = slug(`${p.scope}-${p.object}-${p.function}`);
  else if (call.object === 'luci' && call.method === 'getRealtimeStats') tag = String(p.mode);
  else if (call.object === 'iwinfo' && p.device) tag = slug(String(p.device));
  // Plugin queries: one recording per traffic class and per "one device or all", whatever the time window.
  else if (call.object === 'routelink') tag = [p.class, p.mac ? 'device' : ''].filter(Boolean).join('-');
  return tag ? `${base}.${tag}` : base;
}
