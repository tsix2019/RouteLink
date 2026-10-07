import { randomFillSync } from 'node:crypto';

import { getRandomValues } from 'expo-crypto';

import { randomPassword } from './guestPassword';

// jest-expo's native mock leaves the array untouched; tests choose the draws, or take Node's random bytes.
jest.mock('expo-crypto', () => ({ getRandomValues: jest.fn() }));

const fill = jest.mocked(getRandomValues);

/** Hands out one batch of ten 32-bit draws per call to getRandomValues. */
function draws(...batches: number[][]) {
  for (const batch of batches)
    fill.mockImplementationOnce((array) => {
      (array as Uint32Array).set(batch);
      return array;
    });
}

beforeEach(() => {
  fill.mockReset();
  fill.mockImplementation((array) => randomFillSync(array));
});

describe('randomPassword', () => {
  it('is ten characters guests can type', () => {
    for (let i = 0; i < 200; i++) expect(randomPassword()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
  });

  it('turns each draw into a character by its remainder over the 31-character alphabet', () => {
    draws([0, 1, 30, 31, 32, 61, 62, 100, 4294967291, 7]);
    expect(randomPassword()).toBe('ab9ab9ah9h');
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('throws away the top draws that would favour the first characters, and draws again', () => {
    // 4294967292 = 2^32 - (2^32 % 31): the four draws from there to 2^32 - 1 would land on a, b, c and d.
    draws(
      [4294967295, 4294967292, 4294967291, 0, 0, 0, 0, 0, 0, 0],
      [4294967294, 4294967293, 1, 2, 3, 3, 3, 3, 3, 3],
    );
    expect(randomPassword()).toBe('9aaaaaaabc');
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('asks for 32-bit draws from expo-crypto, not Math.random', () => {
    const mathRandom = jest.spyOn(Math, 'random');
    randomPassword();
    expect(mathRandom).not.toHaveBeenCalled();
    expect(fill.mock.calls[0][0]).toBeInstanceOf(Uint32Array);
    mathRandom.mockRestore();
  });
});
