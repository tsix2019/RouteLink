// Screenshots follow the page: language (zh / en) and theme (light / dark) pick the file.
//   img[data-shot="ios:overview"]  -> media/shots/<lang>/ios-overview-<theme>.webp (+ -360 for srcset)
//   img[data-luci="traffic"]       -> media/luci/<lang>-traffic.webp (+ -640)
//   img[data-widget="router"]      -> media/widgets/widget-preview-[zh-]router.webp
import { lang, onLang } from './i18n.js';
import { onTheme, theme } from './theme.js';
import { $$, reducedMotion } from './util.js';

function source(img) {
  const { shot, luci, widget } = img.dataset;
  if (shot) {
    const [platform, name] = shot.split(':');
    const base = `media/shots/${lang}/${platform}-${name}-${theme()}`;
    return { src: `${base}.webp`, srcset: `${base}-360.webp 360w, ${base}.webp 720w` };
  }
  if (luci) {
    const base = `media/luci/${lang}-${luci}`;
    return { src: `${base}.webp`, srcset: `${base}-640.webp 640w, ${base}.webp 1280w` };
  }
  return { src: `media/widgets/widget-preview-${lang === 'zh' ? 'zh-' : ''}${widget}.webp`, srcset: '' };
}

function onScreen(el) {
  const box = el.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && box.width > 0;
}

function markLoaded(img) {
  const done = () => img.closest('.screen')?.classList.add('loaded');
  if (img.complete && img.naturalWidth) done();
  else img.addEventListener('load', done, { once: true });
}

/** Points img at the file for the current language and theme; cross-fades when it is on screen. */
export function refresh(img, animate = true) {
  const { src, srcset } = source(img);
  if (img.dataset.current === src) return;
  img.dataset.current = src;
  const first = !img.getAttribute('src');
  if (first || !animate || reducedMotion() || !onScreen(img) || !img.closest('.screen')) {
    if (srcset) img.srcset = srcset;
    img.src = src;
    markLoaded(img);
    return;
  }
  // a copy fades in on top; the original then takes the new file (cached by now) and the copy goes
  const token = Symbol('swap');
  img._swap = token;
  const next = new Image();
  next.className = 'shot-next';
  next.alt = '';
  next.sizes = img.sizes;
  if (srcset) next.srcset = srcset;
  next.src = src;
  next
    .decode()
    .catch(() => {})
    .then(() => {
      if (img._swap !== token) return;
      img.after(next);
      requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('in')));
      setTimeout(() => {
        if (srcset) img.srcset = srcset;
        img.src = src;
        img.decode().catch(() => {}).finally(() => next.remove());
      }, 560);
    });
}

export function refreshAll(scope = document) {
  for (const img of $$('img[data-shot], img[data-luci], img[data-widget]', scope)) refresh(img);
}

export function initShots() {
  for (const img of $$('img[data-shot], img[data-luci], img[data-widget]')) refresh(img, false);
  onLang(() => refreshAll());
  onTheme(() => refreshAll());
}
