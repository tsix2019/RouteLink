import fs from 'fs';
import path from 'path';

// Metro tries one extension at a time (.ts before .tsx), and for each the platform's file before the shared
// one: an `update.android.tsx` next to an `update.ts` is never bundled, Android gets the shared file.
function files(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

it('gives platform files the extension of the shared file next to them', () => {
  const all = new Set(files(__dirname));
  const mismatched = [...all].flatMap((file) => {
    const m = /^(.*)\.(?:ios|android|native|web)\.(tsx?|jsx?)$/.exec(file);
    if (!m) return [];
    const [, stem, ext] = m;
    return ['ts', 'tsx', 'js', 'jsx']
      .filter((other) => other !== ext && all.has(`${stem}.${other}`))
      .map((other) => `${path.relative(__dirname, file)} next to ${path.basename(stem)}.${other}`);
  });
  expect(mismatched).toEqual([]);
});
