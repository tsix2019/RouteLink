/**
 * Hermes's Math.random() returns integers up to 2^64 instead of numbers in [0, 1) when the app's ARM code
 * runs on an x86_64 device through ARM translation: the Android emulator (the release APK ships ARM only)
 * and x86 Chromebooks. React Navigation names its navigators with nanoid, which picks each character as
 * alphabet[(Math.random() * 64) | 0], so every navigator became `stack-undefinedundefined…`. expo-router
 * addresses a push to the navigator that should take it and dispatches it from the focused screen; the
 * tab's own stack, holding the root stack's key, claimed a push meant for a root screen, could not handle
 * it and dropped it: the router switcher, the device sheet and the full-screen modals never opened.
 *
 * Replaces such a Math.random() with one drawing 53 random bits per number from `fill`; true if it did.
 */
export function repairMathRandom(fill: (array: Uint32Array) => void): boolean {
  for (let i = 0; i < 4; i++) {
    const x = Math.random();
    if (!(x >= 0 && x < 1)) {
      Math.random = pooledRandom(fill);
      return true;
    }
  }
  return false;
}

function pooledRandom(fill: (array: Uint32Array) => void): () => number {
  const pool = new Uint32Array(256);
  let next = pool.length;
  return () => {
    if (next === pool.length) {
      fill(pool);
      next = 0;
    }
    const high = pool[next++] >>> 5; // 27 bits
    const low = pool[next++] >>> 6; // 26 bits
    return (high * 2 ** 26 + low) / 2 ** 53;
  };
}
