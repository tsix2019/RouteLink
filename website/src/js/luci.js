// The router plugin's LuCI page, drawn in the website with demo data: tabs, charts and the
// period buttons work; nothing here talks to a router.
import { $, $$, reducedMotion, sleep, watch } from './util.js';

const W = 1000;
const H = 200;
const DOWN = '#2f7cf6';
const UP = '#f5a524';

/** Small seeded PRNG, so the demo charts look the same on every visit. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linePath(values, max) {
  const step = W / (values.length - 1);
  return values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(H - (Math.min(v, max) / max) * (H - 14)).toFixed(1)}`).join('');
}

/** series: [{ values, color, fill }]; bands: [[from, to]] as fractions; bars: fractions with loss. */
function draw(svg, series, { max, bands = [], bars = [] }) {
  let out = `<line class="grid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke-dasharray="6 6"/><line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>`;
  for (const [a, b] of bands) out += `<rect x="${a * W}" y="0" width="${Math.max(4, (b - a) * W)}" height="${H}" fill="#f5365c" fill-opacity=".14"/>`;
  for (const x of bars) out += `<rect x="${x * W - 2}" y="${H - 12}" width="4" height="12" fill="#f5365c" fill-opacity=".8"/>`;
  for (const s of series) {
    const d = linePath(s.values, max);
    if (s.fill) out += `<path d="${d}L${W},${H}L0,${H}Z" fill="${s.color}" fill-opacity=".16"/>`;
    out += `<path class="line" d="${d}" stroke="${s.color}"/>`;
  }
  svg.innerHTML = out;
}

const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const md = (d) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesAgo = (m) => new Date(Date.now() - m * 60000);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

function bytes(gb) {
  if (gb >= 100) return `${gb.toFixed(0)} GB`;
  if (gb >= 10) return `${gb.toFixed(1)} GB`;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(gb * 1000)} MB`;
}

/* ---------- Overview: live WAN ---------- */

async function live(root) {
  const svg = $('[data-lm-chart="live"]', root);
  const downText = $('[data-lm-live="down"]', root);
  const upText = $('[data-lm-live="up"]', root);
  const rnd = random(7);
  let d = 28;
  let u = 6;
  const next = () => {
    d = Math.max(3, Math.min(95, d + (28 - d) * 0.2 + (rnd() - 0.5) * 16 + (rnd() < 0.06 ? 40 : 0)));
    u = Math.max(0.5, Math.min(30, u + (6 - u) * 0.3 + (rnd() - 0.5) * 4));
    return [d, u];
  };
  const downs = [];
  const ups = [];
  for (let i = 0; i < 90; i++) {
    const [a, b] = next();
    downs.push(a);
    ups.push(b);
  }
  const render = () => {
    draw(svg, [{ values: downs, color: DOWN, fill: true }, { values: ups, color: UP, fill: true }], { max: 100 });
    downText.textContent = downs.at(-1).toFixed(1);
    upText.textContent = ups.at(-1).toFixed(1);
  };
  render();
  if (reducedMotion()) return;
  const pane = $('[data-lm-pane="overview"]', root);
  const state = watch(svg);
  for (;;) {
    await sleep(state, 2000);
    if (pane.hidden) continue;
    const [a, b] = next();
    downs.shift();
    downs.push(a);
    ups.shift();
    ups.push(b);
    render();
  }
}

/* ---------- Traffic ---------- */

const DEVICES = [
  ['Living-Room-TV', '02:1A:7C:4E:22:01', '192.168.8.106', 10.0, 1.21],
  ['Desk-PC', '02:3B:91:0F:6A:12', '192.168.8.111', 5.24, 2.08],
  ['MacBook-Air', '02:44:C2:5D:19:A3', '192.168.8.102', 4.47, 0.716],
  ['iPhone-16-Pro', '02:5E:08:B7:3C:44', '192.168.8.101', 2.83, 0.412],
  ['Galaxy-S25', '02:6F:D4:21:8E:55', '192.168.8.105', 1.16, 0.205],
  ['iPad-Air', '02:70:1B:93:47:66', '192.168.8.144', 0.95, 0.183],
];

// per period button: points, how much of today's traffic, axis labels
const PERIODS = [
  { points: 60, scale: 0.09, axis: () => [hm(minutesAgo(60)), hm(minutesAgo(30)), hm(new Date())] },
  { points: 0, scale: 1, axis: () => ['00:00', hm(new Date(new Date().setHours(new Date().getHours() / 2 | 0, 0))), hm(new Date())] },
  { points: 288, scale: 1.4, axis: () => ['00:00', '12:00', '23:59'] },
  { points: 168, scale: 8.3, axis: () => [md(daysAgo(6)), md(daysAgo(3)), md(new Date())] },
  { points: 31, scale: 19, axis: () => [md(new Date(new Date().setDate(1))), md(daysAgo(Math.floor((new Date().getDate() - 1) / 2))), md(new Date())] },
  { points: 31, scale: 33, axis: () => { const end = new Date(new Date().setDate(0)); return [md(new Date(end.getFullYear(), end.getMonth(), 1)), md(new Date(end.getFullYear(), end.getMonth(), 15)), md(end)]; } },
  { points: 30, scale: 34, axis: () => [md(daysAgo(29)), md(daysAgo(15)), md(new Date())] },
];

function trafficSeries(period, seed) {
  const rnd = random(seed);
  const now = new Date();
  const n = period.points || Math.max(24, now.getHours() * 12 + Math.floor(now.getMinutes() / 5));
  const downs = [];
  const ups = [];
  for (let i = 0; i < n; i++) {
    // an evening hump for the intraday views, gentle waves for the longer ones
    const hour = period.points === 288 || !period.points ? (i / 12) % 24 : (i / n) * 24;
    const day = 0.25 + 0.75 * Math.max(0, Math.sin(((hour - 7) / 24) * Math.PI * 2)) ** 2;
    const base = period.points <= 31 && period.points ? 0.55 + rnd() * 0.45 : day;
    downs.push(base * (18 + rnd() * 26) + (rnd() < 0.03 ? 40 + rnd() * 50 : 0));
    ups.push(base * (3 + rnd() * 6) + (rnd() < 0.02 ? 10 : 0));
  }
  return { downs, ups };
}

function traffic(root) {
  const pane = $('[data-lm-pane="traffic"]', root);
  const svg = $('[data-lm-chart="traffic"]', pane);
  const axis = $$('[data-lm-axis="traffic"] span', pane);
  const body = $('[data-lm-rank]', pane);
  const totals = $$('[data-lm-total]', pane);
  const buttons = $$('[data-lm-period] button', pane);
  const show = (index) => {
    const period = PERIODS[index];
    buttons.forEach((b, i) => b.classList.toggle('on', i === index));
    const { downs, ups } = trafficSeries(period, 11 + index);
    draw(svg, [{ values: downs, color: DOWN, fill: true }, { values: ups, color: UP, fill: true }], { max: Math.max(...downs) * 1.05 });
    period.axis().forEach((label, i) => (axis[i].textContent = label));
    const rows = DEVICES.map(([name, mac, ip, down, up]) => [name, mac, ip, down * period.scale, up * period.scale]);
    const down = rows.reduce((a, r) => a + r[3], 0) * 1.07;
    const up = rows.reduce((a, r) => a + r[4], 0) * 1.07;
    totals[0].textContent = bytes(down);
    totals[1].textContent = bytes(up);
    totals[2].textContent = `${bytes(down * 1.04)} / ${bytes(up * 1.04)}`;
    const top = rows[0][3] + rows[0][4];
    body.innerHTML = rows
      .map(
        ([name, mac, ip, d, u]) =>
          `<tr><td><a>${name}</a><small>${mac} · ${ip}</small></td><td>${bytes(d)}</td><td>${bytes(u)}</td><td>${bytes(d + u)}</td><td><span class="lm-bar" style="--w:${(((d + u) / top) * 100).toFixed(0)}%"></span></td></tr>`,
      )
      .join('');
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => show(i)));
  show(1);
}

/* ---------- Latency ---------- */

const RANGES = [
  { avail: '100%', outages: '0', downtime: '0m', band: null },
  { avail: '100%', outages: '0', downtime: '0m', band: null },
  { avail: '99.91%', outages: '1', downtime: '1m', band: 0.66 },
  { avail: '99.97%', outages: '1', downtime: '1m', band: 0.82 },
  { avail: '99.95%', outages: '4', downtime: '7m', band: 0.4 },
  { avail: '99.96%', outages: '9', downtime: '22m', band: 0.55 },
];

function latency(root) {
  const pane = $('[data-lm-pane="latency"]', root);
  const svg = $('[data-lm-chart="latency"]', pane);
  const axis = $$('[data-lm-axis="latency"] span', pane);
  const buttons = $$('[data-lm-lrange] button', pane);
  const hours = [1, 6, 24, 168, 720, 2160];
  const show = (index) => {
    buttons.forEach((b, i) => b.classList.toggle('on', i === index));
    const rnd = random(31 + index);
    const n = 200;
    const wave = (base, spread, spike) =>
      Array.from({ length: n }, (_, i) => base + Math.sin(i / 9 + index) * spread * 0.4 + (rnd() - 0.5) * spread + (rnd() < spike ? spread * 4 : 0));
    const range = RANGES[index];
    const bars = Array.from({ length: 6 }, () => rnd()).filter(() => rnd() < 0.7);
    draw(
      svg,
      [
        { values: wave(118, 34, 0.012), color: '#8965e0' },
        { values: wave(16, 6, 0.02), color: '#2dce89' },
        { values: wave(10, 4, 0.02), color: '#f5a524' },
        { values: wave(1.6, 0.8, 0.01), color: '#5e72e4' },
      ],
      { max: 300, bands: range.band ? [[range.band, range.band + 0.006]] : [], bars },
    );
    $('[data-lm-avail]', pane).textContent = range.avail;
    $('[data-lm-outages]', pane).textContent = range.outages;
    $('[data-lm-downtime]', pane).textContent = range.downtime;
    const h = hours[index];
    const label = (ago) => (h <= 24 ? hm(minutesAgo(ago * 60)) : md(daysAgo(ago / 24)));
    [h, h / 2, 0].forEach((ago, i) => (axis[i].textContent = label(ago)));
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => show(i)));
  show(2);
}

/* ---------- Tabs ---------- */

function tabs(root) {
  const list = $('.lm-tabs', root);
  const buttons = $$('[data-lm]', list);
  const page = $('.lm-page', root);
  const path = $('[data-lm-path]', root);
  const select = (btn, focus = false) => {
    for (const b of buttons) b.setAttribute('aria-selected', String(b === btn));
    for (const pane of $$('[data-lm-pane]', root)) pane.hidden = pane.dataset.lmPane !== btn.dataset.lm;
    path.textContent = btn.dataset.lm;
    page.scrollTop = 0;
    btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) btn.focus();
  };
  buttons.forEach((b) => b.addEventListener('click', () => select(b)));
  list.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    select(buttons[(i + step + buttons.length) % buttons.length], true);
  });
}

export function initLuci() {
  const root = $('.lm');
  if (!root) return;
  tabs(root);
  traffic(root);
  latency(root);
  live(root);
}
