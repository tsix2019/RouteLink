import { areaPath, niceMax } from './area-path';

describe('areaPath', () => {
  it('needs at least two points and a positive size', () => {
    expect(areaPath([1], 100, 50, 10)).toEqual({ line: '', area: '' });
    expect(areaPath([1, 2], 0, 50, 10)).toEqual({ line: '', area: '' });
    expect(areaPath([1, 2], 100, 50, 0)).toEqual({ line: '', area: '' });
  });

  it('maps values onto the box, clipping above max', () => {
    const { line, area } = areaPath([0, 5, 20], 100, 50, 10);
    expect(line).toBe('M0.0,50.0L50.0,25.0L100.0,0.0');
    expect(area).toBe('M0.0,50.0L50.0,25.0L100.0,0.0L100.0,50L0,50Z');
  });
});

describe('niceMax', () => {
  it.each([
    [37, 50],
    [812, 1000],
    [100, 100],
    [12_345_678, 20_000_000],
    [0.3, 0.5],
    [0, 1],
    [Number.NaN, 1],
  ])('%d → %d', (value, expected) => {
    expect(niceMax(value)).toBeCloseTo(expected);
  });
});
