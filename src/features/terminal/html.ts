import { TOUCH_SCROLL_JS } from './touchScroll';
import { FIT_JS, XTERM_CSS, XTERM_JS } from './xterm.generated';

/** Terminal colours: the app's light and dark backgrounds, xterm's ANSI palette tuned for each. */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const DARK_THEME: TerminalTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#4c9aff',
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

export const LIGHT_THEME: TerminalTheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0a5bff',
  selectionBackground: '#b6d7ff',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
};

/** Keys of the bar above the keyboard that xterm turns into sequences (it knows the cursor-key mode). */
export type TerminalKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pgup' | 'pgdn';

/** Messages from the page to the app. */
export type TerminalMessage =
  | { type: 'ready'; cols: number; rows: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'copy'; text: string };

/**
 * The page inside the WebView: xterm.js, fitted to the view. The app drives it through `window.rl` (see
 * TerminalView) and hears back through postMessage.
 */
export function terminalHtml(o: { fontSize: number; theme: TerminalTheme }): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${XTERM_CSS}
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${o.theme.background}}
#t{position:absolute;top:6px;left:8px;right:4px;bottom:4px;touch-action:none}
</style>
</head><body><div id="t"></div>
<script>${XTERM_JS}</script>
<script>${FIT_JS}</script>
<script>
(function () {
  var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var term = new Terminal({
    fontSize: ${o.fontSize},
    fontFamily: 'Menlo, "SF Mono", "Roboto Mono", "Droid Sans Mono", monospace',
    theme: ${JSON.stringify(o.theme)},
    cursorBlink: true,
    scrollback: 3000,
    macOptionIsMeta: true,
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  // No word suggestions: a composing keyboard (Gboard) would hold letters back until a word is done,
  // so "q" would not reach top until Enter.
  var ta = term.textarea;
  if (ta) {
    ['autocomplete', 'autocorrect', 'autocapitalize'].forEach(function (a) { ta.setAttribute(a, 'off'); });
    ta.setAttribute('spellcheck', 'false');
  }
  // Fingers: the scrollback scrolls; full-screen programs (vi, less, top, tmux) get wheel steps, which xterm
  // turns into mouse wheel reports when the program asked for the mouse, and into arrow keys otherwise.
  ${TOUCH_SCROLL_JS}
  var plain = function () { return term.buffer.active.type === 'normal' && term.modes.mouseTrackingMode === 'none'; };
  var screen = term.element.querySelector('.xterm-screen');
  touchScroll(document.getElementById('t'), {
    lineHeight: function () { return (screen && screen.clientHeight / term.rows) || 16; },
    scroll: function (lines, x, y) {
      if (plain()) return term.scrollLines(lines);
      for (var i = 0; i < Math.abs(lines); i++) {
        term.element.dispatchEvent(new WheelEvent('wheel', {
          deltaY: lines > 0 ? 1 : -1, deltaMode: 1, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
      }
    },
    canFling: plain,
    requestFrame: function (f) { return requestAnimationFrame(f); },
    cancelFrame: function (id) { cancelAnimationFrame(id); },
  });
  term.onData(function (d) { post({ type: 'input', data: d }); });
  term.onResize(function (s) { post({ type: 'resize', cols: s.cols, rows: s.rows }); });
  window.addEventListener('resize', function () { fit.fit(); });
  var bytes = function (b64) {
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  var csi = function (normal, app) { return term.modes.applicationCursorKeysMode ? app : normal; };
  var KEYS = {
    esc: function () { return '\\x1b'; },
    tab: function () { return '\\t'; },
    up: function () { return csi('\\x1b[A', '\\x1bOA'); },
    down: function () { return csi('\\x1b[B', '\\x1bOB'); },
    right: function () { return csi('\\x1b[C', '\\x1bOC'); },
    left: function () { return csi('\\x1b[D', '\\x1bOD'); },
    home: function () { return csi('\\x1b[H', '\\x1bOH'); },
    end: function () { return csi('\\x1b[F', '\\x1bOF'); },
    pgup: function () { return '\\x1b[5~'; },
    pgdn: function () { return '\\x1b[6~'; },
  };
  window.rl = {
    write: function (b64) { term.write(bytes(b64)); },
    text: function (s) { term.write(s); },
    key: function (name) { var k = KEYS[name]; if (k) post({ type: 'input', data: k() }); },
    paste: function (s) { term.paste(s); },
    copy: function () { post({ type: 'copy', text: term.getSelection() }); },
    selectAll: function () { term.selectAll(); },
    focus: function () { term.focus(); },
    blur: function () { term.blur(); },
    fontSize: function (n) { term.options.fontSize = n; fit.fit(); },
    theme: function (t) { term.options.theme = t; document.body.style.background = t.background; },
    fit: function () { fit.fit(); },
  };
  post({ type: 'ready', cols: term.cols, rows: term.rows });
})();
</script>
</body></html>`;
}
