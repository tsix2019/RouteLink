import { TOUCH_SCROLL_JS } from './touchScroll';

type Handler = (e: FakeEvent) => void;
interface FakeEvent {
  touches: { clientX: number; clientY: number }[];
  timeStamp: number;
  preventDefault: jest.Mock;
}

/** The page script against a fake element: touches go in, scrolled lines come out. */
function setup(o: { canFling?: boolean } = {}) {
  const handlers: Record<string, Handler> = {};
  const el = { addEventListener: (type: string, fn: Handler) => (handlers[type] = fn) };
  const scrolled: number[] = [];
  const frames: ((now: number) => void)[] = [];
  const touchScroll = new Function(`${TOUCH_SCROLL_JS}; return touchScroll;`)() as (el: unknown, o: unknown) => void;
  touchScroll(el, {
    lineHeight: () => 20,
    scroll: (lines: number) => scrolled.push(lines),
    canFling: () => o.canFling ?? true,
    requestFrame: (f: (now: number) => void) => frames.push(f),
    cancelFrame: () => frames.splice(0),
  });
  const fire = (type: string, y: number | null, timeStamp: number, x = 100) => {
    const e: FakeEvent = {
      touches: y === null ? [] : [{ clientX: x, clientY: y }],
      timeStamp,
      preventDefault: jest.fn(),
    };
    handlers[type](e);
    return e;
  };
  /** Runs queued animation frames, 16 ms apart, until the flick stops. */
  const fling = () => {
    let now = 1000;
    for (let i = 0; i < 500 && frames.length; i++) frames.shift()!((now += 16));
  };
  return { fire, fling, scrolled, frames, total: () => scrolled.reduce((a, b) => a + b, 0) };
}

describe('terminal touch scrolling', () => {
  it('scrolls a line per line of finger travel: down shows older output', () => {
    const t = setup();
    t.fire('touchstart', 300, 0);
    const move = t.fire('touchmove', 330, 50);
    t.fire('touchmove', 361, 100);
    expect(move.preventDefault).toHaveBeenCalled();
    expect(t.total()).toBe(-3);
    // 59 px above where it started: two whole lines, the rest kept for the next move.
    t.fire('touchmove', 241, 150);
    expect(t.total()).toBe(2);
    t.fire('touchmove', 240, 160);
    expect(t.total()).toBe(3);
  });

  it('leaves taps and sideways drags alone', () => {
    const t = setup();
    t.fire('touchstart', 300, 0);
    const tap = t.fire('touchmove', 304, 20);
    t.fire('touchend', null, 40);
    expect(tap.preventDefault).not.toHaveBeenCalled();
    t.fire('touchstart', 300, 100, 100);
    t.fire('touchmove', 320, 120, 180);
    expect(t.scrolled).toEqual([]);
  });

  it('keeps going after a flick, slowing to a stop', () => {
    const t = setup();
    t.fire('touchstart', 600, 0);
    t.fire('touchmove', 560, 10);
    t.fire('touchmove', 500, 25);
    t.fire('touchmove', 440, 40);
    t.fire('touchend', null, 45);
    const dragged = t.total();
    expect(t.frames).toHaveLength(1);
    t.fling();
    expect(t.total()).toBeGreaterThan(dragged + 10);
    expect(t.frames).toHaveLength(0);
  });

  it('does not flick when the finger stopped first, or where flicking makes no sense', () => {
    const stopped = setup();
    stopped.fire('touchstart', 600, 0);
    stopped.fire('touchmove', 500, 20);
    stopped.fire('touchend', null, 300);
    expect(stopped.frames).toHaveLength(0);

    const fullScreen = setup({ canFling: false });
    fullScreen.fire('touchstart', 600, 0);
    fullScreen.fire('touchmove', 500, 20);
    fullScreen.fire('touchend', null, 25);
    expect(fullScreen.frames).toHaveLength(0);
  });

  it('a new touch stops a flick', () => {
    const t = setup();
    t.fire('touchstart', 600, 0);
    t.fire('touchmove', 500, 20);
    t.fire('touchend', null, 25);
    expect(t.frames).toHaveLength(1);
    t.fire('touchstart', 300, 100);
    expect(t.frames).toHaveLength(0);
  });
});
