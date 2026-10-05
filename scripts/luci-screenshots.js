// Logs into LuCI on the plugin test router, opens the RouteLink pages and saves full-page screenshots.
// Runs inside ghcr.io/puppeteer/puppeteer (see scripts/luci-screenshots.sh). Prints each page's text and
// any console errors, and exits non-zero when a page does not finish loading.
const puppeteer = require('puppeteer');

const BASE = process.env.BASE || 'http://172.40.0.2';
const OUT = process.env.OUT || '/out';
const LANG = process.env.SHOT_LANG || 'en';
const PW = process.env.ROUTER_PASSWORD || 'routelink-test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // headless "shell": full headless Chrome refuses the router's private address (ERR_BLOCKED_BY_CLIENT)
  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // log in over HTTP and hand the session cookie to the browser
  const login = await fetch(`${BASE}/cgi-bin/luci/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `luci_username=root&luci_password=${encodeURIComponent(PW)}`,
    redirect: 'manual',
  });
  const cookie = (login.headers.getSetCookie() || []).map((c) => /^(sysauth[^=]*)=([^;]+)/.exec(c)).find(Boolean);
  if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);
  await page.setCookie({ name: cookie[1], value: cookie[2], url: BASE });

  let failed = false;
  const shoot = async (name) => {
    await page.screenshot({ path: `${OUT}/${LANG}-${name}.png`, fullPage: true });
  };
  for (const view of ['overview', 'traffic', 'settings']) {
    errors.length = 0;
    await page.goto(`${BASE}/cgi-bin/luci/admin/services/routelink/${view}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => {
        const v = document.querySelector('#view');
        return v && !v.querySelector('.spinning') && !/Loading view|正在加载视图/.test(v.innerText);
      }, { timeout: 20000 });
    } catch {
      failed = true;
    }
    await sleep(view === 'overview' ? 9000 : 3000); /* a few live samples for the chart */
    const text = await page.$eval('#view', (el) => el.innerText);
    console.log(`== ${view}${failed ? ' (did not finish loading)' : ''}\n${text.slice(0, 1200)}\n`);
    if (errors.length) console.log(`console errors on ${view}:\n  ${errors.join('\n  ')}`);
    await shoot(view);
    if (view === 'traffic') {
      await page.evaluate(() => {
        const live = document.querySelector('[data-tab="live"] a');
        if (live) live.click();
      });
      await sleep(5000);
      await shoot('traffic-live');
      const row = await page.$('.cbi-tabmenu');
      if (row) {
        await page.evaluate(() => {
          const ranking = document.querySelector('[data-tab="ranking"] a');
          if (ranking) ranking.click();
        });
        await sleep(1500);
        await page.evaluate(() => {
          const first = document.querySelector('#view table.table tr.tr:not(.table-titles)');
          if (first) first.click();
        });
        await sleep(3000);
        await shoot('traffic-device');
      }
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
