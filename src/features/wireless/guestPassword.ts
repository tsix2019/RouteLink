import { getRandomValues } from 'expo-crypto';

/** Characters guests can type: no look-alikes (0/o, 1/l/i). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 10;
// The largest multiple of the alphabet's size that fits in 32 bits. Draws at or above it are thrown away:
// kept, they would make the first 2^32 % 31 characters a little more likely than the rest.
const LIMIT = 2 ** 32 - (2 ** 32 % ALPHABET.length);

/** A password for a new guest network, from the system's secure random generator. */
export function randomPassword(): string {
  const draws = new Uint32Array(LENGTH);
  let password = '';
  while (password.length < LENGTH) {
    getRandomValues(draws);
    for (const n of draws) {
      if (n < LIMIT && password.length < LENGTH) password += ALPHABET[n % ALPHABET.length];
    }
  }
  return password;
}
