/** SVG path for a line and its filled area. Values above `max` are clipped. */
export function areaPath(values: readonly number[], width: number, height: number, max: number): { line: string; area: string } {
  if (values.length < 2 || max <= 0 || width <= 0 || height <= 0) return { line: '', area: '' };
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - (Math.min(Math.max(v, 0), max) / max) * height] as const);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return { line, area: `${line}L${width.toFixed(1)},${height}L0,${height}Z` };
}

/** Rounds up to 1, 2, 5 × 10^n so axis maxima look tidy. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}
