import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DARK_THEME, terminalHtml } from './html';
import { FIT_VERSION, XTERM_VERSION } from './xterm.generated';

const installed = (name: string) =>
  (
    JSON.parse(readFileSync(join(__dirname, '../../../node_modules', name, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

describe('terminal page', () => {
  it('embeds the installed xterm.js (rerun scripts/build-terminal.ts after an upgrade)', () => {
    expect(XTERM_VERSION).toBe(installed('@xterm/xterm'));
    expect(FIT_VERSION).toBe(installed('@xterm/addon-fit'));
  });

  it('keeps every script element whole and sets the font and colours', () => {
    const html = terminalHtml({ fontSize: 13, theme: DARK_THEME });
    // Three script elements, none cut short by a "</script" inside the vendored code.
    expect(html.match(/<script>/g)).toHaveLength(3);
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(html).toContain('fontSize: 13');
    expect(html).toContain(DARK_THEME.background);
    expect(html).toContain("post({ type: 'ready'");
  });
});
