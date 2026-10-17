// Language: the HTML is pre-rendered in Chinese by build.py; English is applied in place.
import { reducedMotion } from './util.js';

const root = document.documentElement;
const cache = new Map();
const listeners = new Set();

export let lang = root.dataset.lang === 'en' ? 'en' : 'zh';

function flatten(tree, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(tree)) {
    if (value && typeof value === 'object') flatten(value, `${prefix}${key}.`, out);
    else out[prefix + key] = value;
  }
  return out;
}

async function load(next) {
  if (!cache.has(next)) {
    const res = await fetch(`i18n/${next}.json`);
    if (!res.ok) throw new Error(`i18n/${next}.json: ${res.status}`);
    cache.set(next, flatten(await res.json()));
  }
  return cache.get(next);
}

/** The current language's string for key. */
export function t(key) {
  return cache.get(lang)?.[key] ?? key;
}

function apply() {
  const msgs = cache.get(lang);
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = msgs[el.dataset.i18n];
    if (value != null) el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    const value = msgs[el.dataset.i18nHtml];
    if (value != null) el.innerHTML = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [name, key] = pair.split(':');
      if (msgs[key] != null) el.setAttribute(name, msgs[key]);
    }
  }
  root.lang = lang === 'zh' ? 'zh-CN' : 'en';
  root.dataset.lang = lang;
}

export function onLang(fn) {
  listeners.add(fn);
}

export async function setLang(next) {
  if (next === lang) return;
  await load(next);
  const swap = () => {
    lang = next;
    apply();
    for (const fn of listeners) fn(lang);
  };
  if (document.startViewTransition && !reducedMotion()) document.startViewTransition(swap);
  else swap();
  try {
    localStorage.setItem('rl-lang', next);
  } catch {
    // storage may be unavailable (private mode); the choice then lasts for this page only
  }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    history.replaceState(history.state, '', url);
  }
}

export async function initI18n() {
  await load(lang);
  if (lang !== 'zh') apply();
  for (const btn of document.querySelectorAll('[data-action="lang"]')) {
    btn.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
  }
}
