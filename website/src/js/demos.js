// The small live demos: the hero's traffic card and the feature tiles.
import { $, $$, easeOut, reducedMotion, sleep, tween, watch } from './util.js';

/* ---------- Hero: live traffic card ---------- */

function liveTraffic() {
  const card = $('.card-live');
  if (!card) return;
  const svg = $('.spark', card);
  const area = $('.spark-area', svg);
  const downPath = $('.spark-down', svg);
  const upPath = $('.spark-up', svg);
  const downText = $('[data-rate="down"]', card);
  const upText = $('[data-rate="up"]', card);
  const W = 220;
  const H = 64;
  const N = 26;
  const STEP = 1100;
  const MAX = 60;

  let down = 30;
  let up = 6.5;
  const nextDown = () => {
    down += (30 - down) * 0.25 + (Math.random() - 0.5) * 14;
    if (Math.random() < 0.08) down += 22; // the odd burst, like the app's chart
    return (down = Math.min(MAX - 2, Math.max(6, down)));
  };
  const nextUp = () => (up = Math.min(18, Math.max(1.5, up + (6.5 - up) * 0.3 + (Math.random() - 0.5) * 3)));
  const downs = Array.from({ length: N }, nextDown);
  const ups = Array.from({ length: N }, nextUp);

  const y = (v) => H - 3 - (v / MAX) * (H - 8);
  // smooth curve through the points (Catmull-Rom as cubic Béziers)
  const curve = (values, shift) => {
    const dx = W / (N - 3);
    const pts = values.map((v, i) => [(i - 1 - shift) * dx, y(v)]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };
  const draw = (shift) => {
    const d = curve(downs, shift);
    downPath.setAttribute('d', d);
    area.setAttribute('d', `${d}L${W + 40},${H}L-40,${H}Z`);
    upPath.setAttribute('d', curve(ups, shift));
  };

  const shownDown = { v: downs[N - 2] };
  const shownUp = { v: ups[N - 2] };
  const show = () => {
    downText.textContent = shownDown.v.toFixed(1);
    upText.textContent = shownUp.v.toFixed(1);
  };
  draw(0);
  show();
  if (reducedMotion()) return;

  const state = watch(card);
  let last = performance.now();
  const frame = (now) => {
    if (state.on) {
      let p = (now - last) / STEP;
      if (p >= 1) {
        downs.shift();
        downs.push(nextDown());
        ups.shift();
        ups.push(nextUp());
        last = now;
        p = 0;
        const fromD = shownDown.v;
        const fromU = shownUp.v;
        const toD = downs[N - 2];
        const toU = ups[N - 2];
        tween(700, (t) => {
          shownDown.v = fromD + (toD - fromD) * easeOut(t);
          shownUp.v = fromU + (toU - fromU) * easeOut(t);
          show();
        });
      }
      draw(p);
    } else {
      last = now;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ---------- Traffic per device ---------- */

const RANGES = [
  [10.0, 5.2, 4.5, 2.8, 0.3],
  [61.4, 38.2, 27.9, 16.5, 2.1],
  [248, 151, 112, 70.3, 8.6],
];

function trafficBars() {
  const tile = $('.tile-traffic');
  if (!tile) return;
  const rows = $$('.bars li', tile);
  const set = (range) => {
    const values = RANGES[range];
    const max = Math.max(...values);
    rows.forEach((row, i) => {
      $('.bar i', row).style.setProperty('--w', `${(values[i] / max) * 100}%`);
      $('b', row).textContent = `${values[i] < 100 ? values[i].toFixed(1) : Math.round(values[i])} GB`;
    });
  };
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      setTimeout(() => set(0), 250);
    },
    { threshold: 0.4 },
  );
  io.observe(tile);
  $('[data-seg="traffic"]', tile).addEventListener('seg-change', (e) => set(Number(e.detail.dataset.range)));
}

/* ---------- Apply and confirm ---------- */

async function safeRing() {
  const demo = $('.safe-demo');
  if (!demo) return;
  const num = $('.ring-num', demo);
  const setRemaining = (s) => {
    demo.style.setProperty('--p', (s / 90).toFixed(4));
    num.textContent = String(Math.ceil(s));
  };
  if (reducedMotion()) {
    demo.dataset.state = 'confirmed';
    setRemaining(90);
    return;
  }
  const state = watch(demo);
  for (;;) {
    // the app reconnects: the change is confirmed
    demo.dataset.state = 'waiting';
    setRemaining(90);
    await sleep(state, 700);
    await tween(2400, (p) => setRemaining(90 - 6 * p));
    demo.dataset.state = 'confirmed';
    await tween(500, (p) => setRemaining(84 + 6 * easeOut(p)));
    await sleep(state, 2600);
    // the app cannot reconnect: the router rolls back by itself
    demo.dataset.state = 'waiting';
    setRemaining(90);
    await sleep(state, 600);
    await tween(4200, (p) => setRemaining(90 * (1 - p)));
    demo.dataset.state = 'rolled';
    await sleep(state, 2800);
  }
}

/* ---------- SSH terminal ---------- */

const SESSION = [
  ['uptime', ' 21:41:07 up 23 days,  3:14,  load average: 0.08, 0.03, 0.01'],
  ['uci get network.lan.ipaddr', '192.168.8.1'],
  ['ubus list routelink', 'routelink'],
  ['logread -e dnsmasq-dhcp | tail -n 1', 'DHCPACK(br-lan) 192.168.8.101 iPhone-16-Pro'],
  ['free -m | head -2', '        total   used   free\nMem:      491     96    312'],
];

async function terminal() {
  const body = $('.term-body');
  if (!body) return;
  const PROMPT = 'root@OpenWrt:~# ';
  const line = (cls, text) => {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    body.append(div);
    while (body.children.length > 7) body.firstElementChild.remove();
    return div;
  };
  const promptLine = (cmd = '') => {
    const div = line('', '');
    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = PROMPT;
    const c = document.createElement('span');
    c.textContent = cmd;
    div.append(p, c);
    return { div, c };
  };
  if (reducedMotion()) {
    for (const [cmd, out] of SESSION.slice(0, 3)) {
      promptLine(cmd);
      line('o', out);
    }
    return;
  }
  const state = watch(body);
  const caret = document.createElement('span');
  caret.className = 'caret';
  for (let i = 0; ; i = (i + 1) % SESSION.length) {
    const [cmd, out] = SESSION[i];
    const { div, c } = promptLine();
    div.append(caret);
    await sleep(state, 700);
    for (const ch of cmd) {
      c.textContent += ch;
      await sleep(state, 38 + Math.random() * 60);
    }
    await sleep(state, 280);
    caret.remove();
    line('o', out);
    await sleep(state, 1100);
  }
}

/* ---------- Several routers ---------- */

async function routers() {
  const tile = $('.tile-multi');
  if (!tile) return;
  const names = $$('.capsule-names span', tile);
  const rows = $$('.router-list li', tile);
  let i = 0;
  const select = (next) => {
    names.forEach((n, k) => {
      n.classList.toggle('on', k === next);
      n.classList.toggle('out', k === i && k !== next);
    });
    rows.forEach((r, k) => r.classList.toggle('on', k === next));
    i = next;
  };
  select(0);
  if (reducedMotion()) return;
  const state = watch(tile);
  for (;;) {
    await sleep(state, 2600);
    select((i + 1) % names.length);
    await sleep(state, 600);
    names.forEach((n) => n.classList.remove('out'));
  }
}

/* ---------- AI assistant ---------- */

async function chat() {
  const box = $('.chat');
  if (!box) return;
  const me = $('.bubble.me', box);
  const typing = $('.typing', box);
  const answer = $('.answer', box);
  const chip = $('.confirm-chip', box);
  const all = [me, typing, answer, chip];
  if (reducedMotion()) {
    [me, answer, chip].forEach((el) => el.classList.add('show'));
    return;
  }
  const state = watch(box);
  for (;;) {
    await sleep(state, 500);
    me.classList.add('show');
    await sleep(state, 800);
    typing.classList.add('show');
    await sleep(state, 1500);
    typing.classList.remove('show');
    answer.classList.add('show');
    await sleep(state, 1000);
    chip.classList.add('show');
    await sleep(state, 4500);
    all.forEach((el) => el.classList.remove('show'));
    await sleep(state, 600);
  }
}

/* ---------- Widgets and alerts ---------- */

async function toast() {
  const el = $('.widgets-demo .toast');
  if (!el) return;
  if (reducedMotion()) {
    el.classList.add('show');
    return;
  }
  const state = watch(el.parentElement);
  for (;;) {
    await sleep(state, 1400);
    el.classList.add('show');
    await sleep(state, 3600);
    el.classList.remove('show');
  }
}

/* ---------- Liquid Glass tab bar ---------- */

async function tabbar() {
  const bar = $('.tabbar');
  if (!bar) return;
  const tabs = $$('button', bar);
  let touched = false;
  const select = (tab) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    bar.dispatchEvent(new CustomEvent('seg-change', { detail: tab }));
  };
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      touched = true;
      select(tab);
    }),
  );
  if (reducedMotion()) return;
  const state = watch(bar);
  for (let i = 0; !touched; i = (i + 1) % tabs.length) {
    await sleep(state, 2200);
    if (!touched) select(tabs[(i + 1) % tabs.length]);
  }
}

/* ---------- Demo mode ---------- */

function demoSwitch() {
  const tile = $('.tile-demo');
  if (!tile) return;
  const input = $('input', tile);
  input.addEventListener('change', () => tile.classList.toggle('off', !input.checked));
}

export function initDemos() {
  liveTraffic();
  trafficBars();
  safeRing();
  terminal();
  routers();
  chat();
  toast();
  tabbar();
  demoSwitch();
}
