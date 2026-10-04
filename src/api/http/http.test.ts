import RouteLinkNative from 'routelink-native';

import { NativeError, isConnectivityError, toNativeError } from './errors';
import { FakeHttpClient, json, ubusEndpoint } from './fake';
import { nativeHttpClient } from './native';

describe('toNativeError', () => {
  it('wraps errors that carry a known native code', () => {
    const err = toNativeError(Object.assign(new Error('boom'), { code: 'ERR_TIMEOUT' }));
    expect(err).toBeInstanceOf(NativeError);
    expect((err as NativeError).code).toBe('ERR_TIMEOUT');
    expect(isConnectivityError(err)).toBe(true);
  });

  it('keeps TLS errors distinct from connectivity errors', () => {
    const err = toNativeError(Object.assign(new Error('pin'), { code: 'ERR_TLS_PIN_MISMATCH' }));
    expect(isConnectivityError(err)).toBe(false);
  });

  it('passes unknown errors through untouched', () => {
    const original = new Error('other');
    expect(toNativeError(original)).toBe(original);
  });
});

describe('nativeHttpClient', () => {
  it('converts native rejections into NativeError', async () => {
    (RouteLinkNative.httpRequest as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('refused'), { code: 'ERR_UNREACHABLE' }),
    );
    await expect(nativeHttpClient.request({ url: 'http://x/', method: 'GET' })).rejects.toBeInstanceOf(NativeError);
  });
});

describe('FakeHttpClient', () => {
  it('routes requests, records them and expires limited handlers', async () => {
    const fake = new FakeHttpClient()
      .on('GET http://r/a', json({ n: 1 }), 1)
      .on('GET http://r/a', json({ n: 2 }));
    expect(JSON.parse((await fake.request({ url: 'http://r/a', method: 'GET' })).body)).toEqual({ n: 1 });
    expect(JSON.parse((await fake.request({ url: 'http://r/a', method: 'GET' })).body)).toEqual({ n: 2 });
    expect(fake.requests).toHaveLength(2);
    await expect(fake.request({ url: 'http://r/b', method: 'GET' })).rejects.toThrow(/no route/);
  });

  it('answers batched ubus calls by id', async () => {
    const fake = new FakeHttpClient().on(
      'POST http://r/ubus',
      ubusEndpoint({ 'system.board': () => [0, { model: 'X' }], 'system.info': () => [6] }),
    );
    const res = await fake.request({
      url: 'http://r/ubus',
      method: 'POST',
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 7, method: 'call', params: ['sid', 'system', 'board', {}] },
        { jsonrpc: '2.0', id: 8, method: 'call', params: ['sid', 'system', 'info', {}] },
      ]),
    });
    expect(JSON.parse(res.body)).toEqual([
      { jsonrpc: '2.0', id: 7, result: [0, { model: 'X' }] },
      { jsonrpc: '2.0', id: 8, result: [6] },
    ]);
  });
});
