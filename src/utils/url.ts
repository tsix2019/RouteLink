const HOST = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i;

/**
 * Router base URL as stored and used everywhere: scheme + host[:port], no path, no trailing slash.
 * A missing scheme defaults to http (stock OpenWrt serves LuCI over http).
 */
export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('empty address');
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'http';
  if (scheme !== 'http' && scheme !== 'https') throw new Error(`unsupported scheme: ${scheme}`);
  s = schemeMatch ? s.slice(schemeMatch[0].length) : s;
  const host = s.split('/')[0].toLowerCase();
  if (!host || !HOST.test(host)) throw new Error(`invalid host: ${input}`);
  return `${scheme}://${host}`;
}

export const isHttps = (baseUrl: string): boolean => baseUrl.startsWith('https://');
