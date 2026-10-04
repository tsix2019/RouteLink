export interface RatePoint {
  /** ms timestamp of the later sample */
  t: number;
  rxBps: number;
  txBps: number;
}

/** Turns cumulative byte counters into bit rates; keeps the last `capacity` points. */
export class RateTracker {
  private last?: { t: number; rx: number; tx: number };
  private readonly points: RatePoint[] = [];

  constructor(private readonly capacity = 60) {}

  /** Returns the new point, or null for the first sample / a counter reset (router reboot). */
  push(t: number, rx: number, tx: number): RatePoint | null {
    const prev = this.last;
    this.last = { t, rx, tx };
    if (!prev || t <= prev.t || rx < prev.rx || tx < prev.tx) return null;
    const dt = (t - prev.t) / 1000;
    const point = { t, rxBps: ((rx - prev.rx) * 8) / dt, txBps: ((tx - prev.tx) * 8) / dt };
    this.points.push(point);
    if (this.points.length > this.capacity) this.points.shift();
    return point;
  }

  get series(): readonly RatePoint[] {
    return this.points;
  }

  get latest(): RatePoint | undefined {
    return this.points[this.points.length - 1];
  }

  reset(): void {
    this.last = undefined;
    this.points.length = 0;
  }

  /** Starts an empty tracker with earlier points (the demo router's made-up history). */
  seed(points: readonly RatePoint[]): void {
    if (this.points.length) return;
    this.points.push(...points.slice(-this.capacity));
  }
}
