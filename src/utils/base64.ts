const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding; plain JS so it behaves the same on Hermes, iOS and in Node tests. */
export function bytesToBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], ALPHABET[n & 63]);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], '==');
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], '=');
  }
  return out.join('');
}
