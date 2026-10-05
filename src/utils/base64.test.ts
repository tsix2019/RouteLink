import { base64ToBytes, bytesToBase64 } from './base64';

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

describe('base64ToBytes', () => {
  it.each(['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYmFy'])('decodes %j back', (text) => {
    expect(bytesToBase64(base64ToBytes(text))).toBe(text);
  });

  it('matches Node, ignores line breaks and refuses other characters', () => {
    const data = new Uint8Array(4_099).map((_, i) => (i * 37 + 11) & 0xff);
    const text = Buffer.from(data).toString('base64');
    expect(base64ToBytes(text)).toEqual(data);
    expect(base64ToBytes(text.replace(/(.{76})/g, '$1\n'))).toEqual(data);
    expect(() => base64ToBytes('Zm9v!')).toThrow('invalid base64');
  });
});
