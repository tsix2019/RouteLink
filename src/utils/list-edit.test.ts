import { findNearest, withEntry } from './list-edit';

describe('withEntry', () => {
  const list = ['a', 'b', 'c'];

  it('appends when there is no index', () => {
    expect(withEntry(list, null, 'd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('replaces the entry at the index', () => {
    expect(withEntry(list, 1, 'B')).toEqual(['a', 'B', 'c']);
  });

  it('removes the entry at the index', () => {
    expect(withEntry(list, 0, null)).toEqual(['b', 'c']);
    expect(withEntry(list, 2, null)).toEqual(['a', 'b']);
  });

  it('leaves the list it was given alone', () => {
    withEntry(list, 1, 'B');
    withEntry(list, 1, null);
    withEntry(list, null, 'd');
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('throws for an index outside the list', () => {
    expect(() => withEntry(list, 3, 'x')).toThrow(RangeError);
    expect(() => withEntry(list, -1, null)).toThrow(RangeError);
    expect(() => withEntry(list, 1.5, 'x')).toThrow(RangeError);
  });

  it('throws when asked to append nothing', () => {
    expect(() => withEntry(list, null, null)).toThrow(RangeError);
  });
});

describe('findNearest', () => {
  const is = (x: string) => (e: string) => e === x;

  it('is the index of the match closest to where the entry was', () => {
    expect(findNearest(['a', 'b', 'c'], is('b'), 1)).toBe(1);
    expect(findNearest(['x', 'a', 'b', 'c'], is('b'), 1)).toBe(2);
    expect(findNearest(['b', 'a', 'a', 'b'], is('b'), 2)).toBe(3);
    expect(findNearest(['b', 'a', 'a', 'b'], is('b'), 1)).toBe(0);
  });

  it('is null without a match', () => {
    expect(findNearest(['a', 'c'], is('b'), 1)).toBeNull();
    expect(findNearest([], is('b'), 0)).toBeNull();
  });
});
