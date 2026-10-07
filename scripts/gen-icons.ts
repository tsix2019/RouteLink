// Renders every icon asset from assets/icon/glyph.ts. Run: npx tsx scripts/gen-icons.ts
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { glyph, gradientDefs, svg } from '../assets/icon/glyph';

const root = join(__dirname, '..');

function png(svgText: string, size: number): Buffer {
  return new Resvg(svgText, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

function write(rel: string, data: string | Buffer) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', rel);
}

const background = `${gradientDefs()}<rect width="1024" height="1024" fill="url(#bg)"/>`;

// Store / legacy icon: full-bleed gradient + glyph (platforms apply their own mask).
write('assets/images/icon.png', png(svg(background + glyph()), 1024));
// Android adaptive icon layers. The glyph already sits inside the 66% safe zone.
write('assets/images/android-icon-background.png', png(svg(background), 1024));
write('assets/images/android-icon-foreground.png', png(svg(glyph()), 1024));
write('assets/images/android-icon-monochrome.png', png(svg(glyph()), 1024));
// iOS 26 Icon Composer bundle: system renders the glass material over a gradient fill.
write('assets/routelink.icon/Assets/glyph.svg', svg(glyph()));
write('assets/icon/routelink.svg', svg(background + glyph()));
