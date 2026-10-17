// Page-wide motion: reveal on scroll, counters, the hero's pointer parallax, magnetic buttons,
// the spotlight on feature tiles, the navigation's scrolled state and the marquee.
import { $, $$, clamp, easeOut, finePointer, onceVisible, reducedMotion, tween } from './util.js';

function reveal() {
  const items = $$('[data-reveal]');
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
}

function counters() {
  for (const el of $$('[data-count]')) {
    const target = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals || 0);
    const format = (v) => v.toFixed(decimals);
    if (reducedMotion()) continue;
    el.textContent = format(0);
    onceVisible(el, () => tween(1800, (p) => (el.textContent = format(target * easeOut(p)))), 0.6);
  }
}

function parallax() {
  const stage = $('[data-tilt]');
  if (!stage) return;
  for (const layer of $$('.layer', stage)) layer.style.setProperty('--d', layer.dataset.depth || 1);
  if (reducedMotion() || !finePointer()) return;
  const hero = stage.closest('section');
  let tx = 0;
  let ty = 0;
  let x = 0;
  let y = 0;
  let running = false;
  const frame = () => {
    x += (tx - x) * 0.08;
    y += (ty - y) * 0.08;
    stage.style.setProperty('--mx', x.toFixed(4));
    stage.style.setProperty('--my', y.toFixed(4));
    if (Math.abs(tx - x) > 0.001 || Math.abs(ty - y) > 0.001) requestAnimationFrame(frame);
    else running = false;
  };
  const kick = () => {
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  };
  hero.addEventListener('pointermove', (e) => {
    const box = hero.getBoundingClientRect();
    tx = clamp(((e.clientX - box.left) / box.width) * 2 - 1, -1, 1);
    ty = clamp(((e.clientY - box.top) / box.height) * 2 - 1, -1, 1);
    kick();
  });
  hero.addEventListener('pointerleave', () => {
    tx = 0;
    ty = 0;
    kick();
  });
}

function magnetic() {
  if (reducedMotion() || !finePointer()) return;
  for (const el of $$('.magnetic')) {
    el.addEventListener('pointermove', (e) => {
      const box = el.getBoundingClientRect();
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height / 2);
      el.style.translate = `${dx * 0.18}px ${dy * 0.28}px`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.translate = '';
    });
  }
}

function spotlight() {
  if (!finePointer()) return;
  for (const tile of $$('.tile')) {
    tile.addEventListener('pointermove', (e) => {
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--x', `${e.clientX - box.left}px`);
      tile.style.setProperty('--y', `${e.clientY - box.top}px`);
    });
  }
}

function nav() {
  const header = $('.nav');
  const update = () => header.classList.toggle('scrolled', scrollY > 8);
  update();
  addEventListener('scroll', update, { passive: true });

  const links = new Map($$('.nav-links a').map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = links.get(entry.target.id);
        if (!link) continue;
        if (entry.isIntersecting) {
          links.forEach((a) => a.classList.remove('active'));
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) io.observe(section);
  }

  const menuBtn = $('[data-action="menu"]');
  const setOpen = (open) => {
    header.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setOpen(!header.classList.contains('open')));
  $$('.mobile-menu a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  document.addEventListener('click', (e) => {
    if (header.classList.contains('open') && !header.contains(e.target)) setOpen(false);
  });
}

function marquee() {
  const track = $('.marquee-track');
  if (!track) return;
  const copy = track.firstElementChild.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.append(copy);
}

export function initMotion() {
  reveal();
  counters();
  parallax();
  magnetic();
  spotlight();
  nav();
  marquee();
}
