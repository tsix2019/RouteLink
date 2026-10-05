import { NativeError } from './errors';
import type { HttpClient } from './types';

function mapNodeError(error: unknown): unknown {
  const e = error as { name?: string; cause?: { code?: string }; message?: string };
  if (e?.name === 'AbortError') return new NativeError('ERR_TIMEOUT', 'request timed out');
  switch (e?.cause?.code) {
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ECONNRESET':
      return new NativeError('ERR_UNREACHABLE', e.message ?? 'unreachable');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new NativeError('ERR_DNS', e.message ?? 'unknown host');
    case 'UND_ERR_CONNECT_TIMEOUT':
      return new NativeError('ERR_TIMEOUT', 'connect timed out');
    default:
      return new NativeError('ERR_NETWORK', e?.message ?? String(error));
  }
}

/** Node implementation for scripts and integration tests. System TLS only (no pinning). */
export const nodeHttpClient: HttpClient = {
  async request(req) {
    if (req.tls && req.tls.mode !== 'system') {
      throw new NativeError('ERR_INVALID_ARGUMENT', 'the node client only supports system TLS');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10_000);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'POST' ? (req.body ?? '') : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      const headers: Record<string, string[]> = {};
      res.headers.forEach((value, name) => {
        if (name !== 'set-cookie') (headers[name] ??= []).push(value);
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      const body =
        req.responseEncoding === 'base64' ? Buffer.from(await res.arrayBuffer()).toString('base64') : await res.text();
      return { status: res.status, headers, body };
    } catch (error) {
      throw mapNodeError(error);
    } finally {
      clearTimeout(timer);
    }
  },
};
