import { bytesToBase64 } from './base64';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('bytesToBase64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j (RFC 4648 vectors)', (input, expected) => {
    expect(bytesToBase64(bytes(input))).toBe(expected);
  });

  it('matches Node for binary data of any length', () => {
    const data = new Uint8Array(70_001).map((_, i) => (i * 131 + 7) & 0xff);
    expect(bytesToBase64(data)).toBe(Buffer.from(data).toString('base64'));
    expect(bytesToBase64(data.subarray(3, 32_771))).toBe(Buffer.from(data.subarray(3, 32_771)).toString('base64'));
  });
});
