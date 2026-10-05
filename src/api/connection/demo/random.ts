/** Small deterministic PRNG (mulberry32) so demo data and screenshots are reproducible. */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    hex: (bytes: number) =>
      Array.from({ length: bytes }, () =>
        Math.floor(next() * 256)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase(),
      ),
  };
}

export type Random = ReturnType<typeof createRandom>;

/** A stable number in [0, 1) for a tuple of integers: the same inputs always give the same value. */
export function hash01(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}
