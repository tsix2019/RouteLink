// Small helpers shared by the page scripts.

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

export const reducedMotion = () => motionQuery.matches;
export const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Tracks whether an element is on screen (and the page visible), so looping demos
 * only run while someone can see them.
 */
export function watch(el, margin = '0px') {
  const state = { on: false, waiters: [] };
  const update = (intersecting) => {
    state.intersecting = intersecting ?? state.intersecting;
    state.on = Boolean(state.intersecting) && !document.hidden;
    if (state.on) state.waiters.splice(0).forEach((resolve) => resolve());
  };
  new IntersectionObserver(([entry]) => update(entry.isIntersecting), { rootMargin: margin }).observe(el);
  document.addEventListener('visibilitychange', () => update());
  return state;
}

/** Waits ms, then until the watched element is visible again. */
export async function sleep(state, ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  while (state && !state.on) await new Promise((resolve) => state.waiters.push(resolve));
}

/** Runs fn(progress 0..1) on animation frames for ms; resolves when done. */
export function tween(ms, fn) {
  return new Promise((resolve) => {
    if (reducedMotion() || ms <= 0) {
      fn(1);
      resolve();
      return;
    }
    const start = performance.now();
    const frame = (now) => {
      const p = clamp((now - start) / ms, 0, 1);
      fn(p);
      if (p < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** Calls fn once when el first scrolls into view. */
export function onceVisible(el, fn, threshold = 0.25) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { threshold },
  );
  io.observe(el);
}
