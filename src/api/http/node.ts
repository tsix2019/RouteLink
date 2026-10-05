import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { NativeError } from './errors';
import type { HttpClient } from './types';

function mapNodeError(error: unknown): unknown {
  const e = error as { code?: string; cause?: { code?: string }; message?: string };
  switch (e?.code ?? e?.cause?.code) {
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ECONNRESET':
      return new NativeError('ERR_UNREACHABLE', e.message ?? 'unreachable');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new NativeError('ERR_DNS', e.message ?? 'unknown host');
    case 'ETIMEDOUT':
      return new NativeError('ERR_TIMEOUT', 'request timed out');
    default:
      return new NativeError('ERR_NETWORK', e?.message ?? String(error));
  }
}

/**
 * Node implementation for scripts and integration tests. System TLS only (no pinning).
 *
 * node:http with the lenient parser, not fetch: uhttpd on 23.05 sends a CGI's Content-Length next to its own
 * chunked encoding (cgi-download does that), which Node's strict parser rejects and OkHttp and URLSession accept.
 */
export const nodeHttpClient: HttpClient = {
  request(req) {
    if (req.tls && req.tls.mode !== 'system') {
      return Promise.reject(new NativeError('ERR_INVALID_ARGUMENT', 'the node client only supports system TLS'));
    }
    const url = new URL(req.url);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const body = req.method === 'POST' ? (req.body ?? '') : undefined;
    return new Promise((resolve, reject) => {
      const r = send(
        url,
        {
          method: req.method,
          headers: { ...req.headers, ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}) },
          insecureHTTPParser: true,
          // A connection each: uhttpd drops the connection after a 404 while still announcing keep-alive.
          agent: false,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', (e) => reject(mapNodeError(e)));
          res.on('end', () => {
            clearTimeout(timer);
            const headers: Record<string, string[]> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (value !== undefined) headers[name] = Array.isArray(value) ? value : [value];
            }
            const data = Buffer.concat(chunks);
            resolve({
              status: res.statusCode ?? 0,
              headers,
              body: req.responseEncoding === 'base64' ? data.toString('base64') : data.toString('utf8'),
            });
          });
        },
      );
      const timer = setTimeout(() => {
        r.destroy();
        reject(new NativeError('ERR_TIMEOUT', 'request timed out'));
      }, req.timeoutMs ?? 10_000);
      r.on('error', (e) => {
        clearTimeout(timer);
        reject(mapNodeError(e));
      });
      r.end(body);
    });
  },
};
