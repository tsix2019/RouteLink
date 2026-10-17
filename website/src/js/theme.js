// Light / dark. The inline script in <head> sets the first value; this keeps it in step with the
// system until the visitor picks one, and animates the switch as a circle opening from the button.
import { reducedMotion } from './util.js';

const root = document.documentElement;
const system = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export const theme = () => root.dataset.theme;

function stored() {
  try {
    return localStorage.getItem('rl-theme');
  } catch {
    return null;
  }
}

function set(next) {
  root.dataset.theme = next;
  for (const fn of listeners) fn(next);
}

function remember(next) {
  try {
    // picking what the system shows anyway means "follow the system" again
    if (next === (system.matches ? 'dark' : 'light')) localStorage.removeItem('rl-theme');
    else localStorage.setItem('rl-theme', next);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}

function toggle(btn) {
  const next = theme() === 'dark' ? 'light' : 'dark';
  remember(next);
  if (!document.startViewTransition || reducedMotion()) {
    set(next);
    return;
  }
  const box = btn.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add('theme-vt');
  const transition = document.startViewTransition(() => set(next));
  transition.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(.2, .75, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => {});
  transition.finished.finally(() => root.classList.remove('theme-vt'));
}

export function onTheme(fn) {
  listeners.add(fn);
}

export function initTheme() {
  system.addEventListener('change', (e) => {
    if (!stored()) set(e.matches ? 'dark' : 'light');
  });
  for (const btn of document.querySelectorAll('[data-action="theme"]')) {
    btn.addEventListener('click', () => toggle(btn));
  }
}
