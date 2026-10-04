import type { HttpClient, HttpRequest, HttpResponse } from './types';

type Handler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
type Matcher = (req: HttpRequest) => boolean;

export const json = (body: unknown, status = 200, headers: Record<string, string[]> = {}): HttpResponse => ({
  status,
  headers: { 'content-type': ['application/json'], ...headers },
  body: JSON.stringify(body),
});

/** Test double: routes requests to handlers and records everything it receives. */
export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  private readonly routes: { match: Matcher; handler: Handler; remaining: number }[] = [];

  /** `match` is "METHOD url" (exact) or a predicate. Handlers registered with `times` expire after that many uses. */
  on(match: string | Matcher, handler: Handler | HttpResponse | Error, times = Infinity): this {
    const predicate: Matcher = typeof match === 'string' ? (req) => `${req.method} ${req.url}` === match : match;
    const fn: Handler =
      handler instanceof Error
        ? () => {
            throw handler;
          }
        : typeof handler === 'function'
          ? handler
          : () => handler;
    this.routes.push({ match: predicate, handler: fn, remaining: times });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const route = this.routes.find((r) => r.remaining > 0 && r.match(req));
    if (!route) throw new Error(`FakeHttpClient: no route for ${req.method} ${req.url}`);
    route.remaining -= 1;
    return route.handler(req);
  }
}

/** A ubus handler returns the JSON-RPC `result` array ([0, data], [6], ...) or `{ error }`. */
export type UbusHandler = (
  params: Record<string, unknown>,
  sid: string,
) => unknown[] | { error: { code: number; message: string } };

/** Builds a handler that answers single or batched ubus JSON-RPC calls by "object.method". */
export function ubusEndpoint(handlers: Record<string, UbusHandler>): Handler {
  return (req) => {
    const payload = JSON.parse(req.body ?? 'null');
    const calls: { id: number; params: [string, string, string, Record<string, unknown>] }[] = Array.isArray(payload)
      ? payload
      : [payload];
    const replies = calls.map((call) => {
      const [sid, object, method, params] = call.params;
      const handler = handlers[`${object}.${method}`];
      const out = handler ? handler(params, sid) : [3];
      return Array.isArray(out)
        ? { jsonrpc: '2.0', id: call.id, result: out }
        : { jsonrpc: '2.0', id: call.id, error: out.error };
    });
    return json(Array.isArray(payload) ? replies : replies[0]);
  };
}
