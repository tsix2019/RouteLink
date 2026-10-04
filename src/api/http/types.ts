import type { TlsOptions } from 'routelink-native';

export type { TlsOptions };

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  tls?: TlsOptions;
}

/** Header names are lower-case; values keep repeated headers (Set-Cookie) separate. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string[]>;
  body: string;
}

/** Never follows redirects and never stores cookies. */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}
