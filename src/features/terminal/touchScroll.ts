/**
 * Finger scrolling for the terminal page, as page script: xterm.js 6 scrolls with the mouse wheel only, so a
 * drag on a phone did nothing. A vertical drag moves the terminal one line per line of finger travel, and a flick
 * keeps the scrollback going until it slows to a stop. Taps and sideways drags are left alone (a tap focuses the
 * terminal and opens the keyboard), and so are two-finger gestures.
 *
 * `o.scroll(lines, x, y)` gets whole lines, positive towards newer output, and where the finger is.
 */
export const TOUCH_SCROLL_JS = `function touchScroll(el, o) {
  var SLOP = 8, FRICTION = 0.95, MIN_FLICK = 0.3, MIN_SPEED = 0.03;
  var startX = 0, startY = 0, lastX = 0, lastY = 0, dragging = false, ignore = false;
  var partial = 0, samples = [], frame = 0;
  var stopFling = function () { if (frame) { o.cancelFrame(frame); frame = 0; } };
  var move = function (dy) {
    partial += -dy / o.lineHeight();
    var lines = partial > 0 ? Math.floor(partial) : Math.ceil(partial);
    if (lines) { partial -= lines; o.scroll(lines, lastX, lastY); }
  };
  el.addEventListener('touchstart', function (e) {
    stopFling();
    ignore = e.touches.length > 1;
    if (ignore) return;
    var t = e.touches[0];
    startX = lastX = t.clientX; startY = lastY = t.clientY;
    dragging = false; partial = 0; samples = [{ y: t.clientY, t: e.timeStamp }];
  }, { passive: true });
  el.addEventListener('touchmove', function (e) {
    if (ignore || e.touches.length > 1) { ignore = true; dragging = false; return; }
    var t = e.touches[0];
    if (!dragging) {
      var dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.abs(dy) < SLOP || Math.abs(dy) < Math.abs(dx)) return;
      dragging = true;
    }
    e.preventDefault();
    lastX = t.clientX;
    move(t.clientY - lastY);
    lastY = t.clientY;
    samples.push({ y: t.clientY, t: e.timeStamp });
    while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
  }, { passive: false });
  el.addEventListener('touchend', function (e) {
    if (!dragging) return;
    dragging = false;
    if (!o.canFling()) return;
    var first = samples[0], last = samples[samples.length - 1], span = last.t - first.t;
    // A finger that stopped before it lifted means no flick.
    if (span <= 0 || e.timeStamp - last.t > 80) return;
    var v = (last.y - first.y) / span;
    if (Math.abs(v) < MIN_FLICK) return;
    var prev = 0;
    var step = function (now) {
      var dt = prev ? Math.min(now - prev, 40) : 0;
      prev = now;
      move(v * dt);
      v *= Math.pow(FRICTION, dt / 16);
      frame = Math.abs(v) > MIN_SPEED ? o.requestFrame(step) : 0;
    };
    frame = o.requestFrame(step);
  }, { passive: true });
  el.addEventListener('touchcancel', function () { dragging = false; }, { passive: true });
}`;
