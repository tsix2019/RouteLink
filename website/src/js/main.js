// Entry point. The page stays transparent until the language is applied, then fades in.
import { initDemos } from './demos.js';
import { initI18n } from './i18n.js';
import { initLuci } from './luci.js';
import { initMotion } from './motion.js';
import { initRelease } from './release.js';
import { initShots } from './shots.js';
import { initTheme } from './theme.js';
import { initUi } from './ui.js';

const root = document.documentElement;

try {
  await initI18n();
  initTheme();
  initShots();
} catch (err) {
  console.error(err);
} finally {
  root.classList.add('ready');
}

initMotion();
initUi();
initDemos();
initLuci();
initRelease();
