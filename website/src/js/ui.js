// Interactive pieces: segmented controls and tabs, the scroll tour, the screenshot rail,
// the feature list and the install commands.
import { lang, onLang, t } from './i18n.js';
import { refresh } from './shots.js';
import { $, $$, reducedMotion } from './util.js';

/* ---------- Segmented controls ---------- */

function syncThumb(list, animate = true) {
  const thumb = $('.seg-thumb, .tab-thumb', list);
  const tab = $('[aria-selected="true"]', list);
  if (!thumb || !tab || !tab.offsetWidth) return;
  thumb.classList.toggle('no-anim', !animate);
  thumb.style.width = `${tab.offsetWidth}px`;
  thumb.style.transform = `translateX(${tab.offsetLeft}px)`;
  if (!animate) requestAnimationFrame(() => thumb.classList.remove('no-anim'));
}

function select(list, tab, focus = false) {
  for (const other of $$('[role="tab"]', list)) {
    const on = other === tab;
    other.setAttribute('aria-selected', String(on));
    if (list.classList.contains('tab-list')) other.tabIndex = on ? 0 : -1;
  }
  if (focus) tab.focus();
  syncThumb(list);
  list.dispatchEvent(new CustomEvent('seg-change', { detail: tab }));
}

function segments() {
  const lists = $$('.seg, .tab-list, .tabbar');
  for (const list of lists) {
    syncThumb(list, false);
    list.addEventListener('seg-change', (e) => e.target === list && syncThumb(list));
    if (list.classList.contains('tabbar')) continue; // demos.js drives the tab bar demo
    const tabs = $$('[role="tab"]', list);
    tabs.forEach((tab) => tab.addEventListener('click', () => tab.getAttribute('aria-selected') !== 'true' && select(list, tab)));
    list.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        select(list, tabs[(i + step + tabs.length) % tabs.length], true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        select(list, tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
      }
    });
  }
  const resync = () => lists.forEach((list) => syncThumb(list, false));
  addEventListener('resize', resync);
  onLang(() => requestAnimationFrame(resync));
  document.fonts?.ready.then(resync);
}

/* ---------- Scroll tour ---------- */

function tour() {
  const steps = $$('.tour .step');
  const img = $('.tour-sticky img');
  const dots = $$('.tour-dots li');
  if (!steps.length || !img) return;
  const activate = (index) => {
    steps.forEach((s, i) => s.classList.toggle('active', i === index));
    dots.forEach((d, i) => d.classList.toggle('on', i === index));
    img.dataset.shot = `ios:${steps[index].dataset.shotName}`;
    refresh(img);
  };
  activate(0);
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) activate(steps.indexOf(entry.target));
    },
    { rootMargin: '-50% 0px -50% 0px' },
  );
  steps.forEach((s) => io.observe(s));
}

/* ---------- Screenshot rail ---------- */

function rail() {
  const el = $('.rail');
  if (!el) return;
  const bar = $('.rail-progress i');
  const progress = () => {
    const w = (el.clientWidth / el.scrollWidth) * 100;
    const l = (el.scrollLeft / el.scrollWidth) * 100;
    bar.style.setProperty('--w', `${w}%`);
    bar.style.setProperty('--l', `${l}%`);
  };
  progress();
  el.addEventListener('scroll', progress, { passive: true });
  addEventListener('resize', progress);

  const stride = () => {
    const card = $('.shot-card', el);
    return card ? card.getBoundingClientRect().width + 28 : 260;
  };
  $$('[data-rail]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const dir = btn.dataset.rail === 'next' ? 1 : -1;
      el.scrollBy({ left: dir * stride() * 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }),
  );
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      el.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * stride(), behavior: 'smooth' });
    }
  });

  // drag to scroll with a mouse; touch scrolls natively
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    start = { x: e.clientX, left: el.scrollLeft, moved: false };
  });
  addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (!start.moved && Math.abs(dx) > 4) {
      start.moved = true;
      el.classList.add('dragging');
    }
    if (start.moved) el.scrollLeft = start.left - dx;
  });
  addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    el.classList.remove('dragging');
  });
  el.addEventListener('dragstart', (e) => e.preventDefault());

  // iOS / Android
  $('[data-seg="platform"]').addEventListener('seg-change', (e) => {
    const platform = e.detail.dataset.platform;
    if (platform === el.dataset.platform) return;
    el.classList.add('swapping');
    setTimeout(
      () => {
        el.dataset.platform = platform;
        for (const phone of $$('.phone', el)) {
          phone.classList.toggle('ios', platform === 'ios');
          phone.classList.toggle('android', platform === 'android');
        }
        for (const img of $$('img[data-shot]', el)) {
          img.dataset.shot = `${platform}:${img.dataset.shot.split(':')[1]}`;
          refresh(img, false);
        }
        el.scrollTo({ left: 0 });
        progress();
        requestAnimationFrame(() => el.classList.remove('swapping'));
      },
      reducedMotion() ? 0 : 300,
    );
  });
}

/* ---------- Feature list ---------- */

function featureTabs() {
  const list = $('.tabs .tab-list');
  if (!list) return;
  for (const panel of $$('.tab-panel')) $$('li', panel).forEach((li, i) => li.style.setProperty('--n', i));
  list.addEventListener('seg-change', (e) => {
    const id = e.detail.getAttribute('aria-controls');
    for (const panel of $$('.tab-panel')) panel.hidden = panel.id !== id;
  });
}

/* ---------- Install commands ---------- */

function install() {
  const seg = $('[data-seg="install"]');
  if (!seg) return;
  seg.addEventListener('seg-change', (e) => {
    for (const pane of $$('.code-pane')) pane.hidden = pane.dataset.pane !== e.detail.dataset.pane;
  });
  for (const btn of $$('[data-copy]')) {
    const label = $('span', btn);
    let timer;
    btn.addEventListener('click', async () => {
      const code = $('code', btn.parentElement).textContent.trim();
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const range = document.createRange();
        range.selectNodeContents($('code', btn.parentElement));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return;
      }
      btn.classList.add('done');
      label.textContent = t('plugin.copied');
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove('done');
        label.textContent = t('plugin.copy');
      }, 1800);
    });
  }
}

/* ---------- Links that depend on the language ---------- */

function githubReadme() {
  // the English README lives next to the Chinese one
  const update = () => {
    for (const a of $$('a[href="https://github.com/tsix2019/RouteLink"], a[href$="README.en.md"]')) {
      if (a.closest('.footer-links, .hero-cta, .nav-actions, .mobile-menu')) {
        a.href = lang === 'en' ? 'https://github.com/tsix2019/RouteLink/blob/main/README.en.md' : 'https://github.com/tsix2019/RouteLink';
      }
    }
  };
  update();
  onLang(update);
}

export function initUi() {
  segments();
  tour();
  rail();
  featureTabs();
  install();
  githubReadme();
}
