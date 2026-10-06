/**
 * One entry of a list changed, as a new list: append (`index` null), replace, or remove (`entry` null).
 * Pages that edit one entry of a list saved as a whole (Wi-Fi schedule, parental control) build on this.
 */
export function withEntry<T>(list: readonly T[], index: number | null, entry: T | null): T[] {
  if (index === null) {
    if (entry === null) throw new RangeError('nothing to add');
    return [...list, entry];
  }
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new RangeError(`no entry ${index} in a list of ${list.length}`);
  }
  return entry === null ? list.filter((_, i) => i !== index) : list.map((e, i) => (i === index ? entry : e));
}

/**
 * Where an entry being edited sits in the list read again, which may have changed meanwhile: the match
 * nearest to `near` (where it was), the earlier one on a tie. Null once nothing matches.
 */
export function findNearest<T>(list: readonly T[], matches: (entry: T) => boolean, near: number): number | null {
  let found: number | null = null;
  list.forEach((e, i) => {
    if (matches(e) && (found === null || Math.abs(i - near) < Math.abs(found - near))) found = i;
  });
  return found;
}
