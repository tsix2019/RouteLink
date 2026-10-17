# RouteLink website

The product page at <https://tsix2019.github.io/RouteLink/>: static HTML, CSS and JavaScript modules,
no npm dependencies. Design notes: [docs/superpowers/specs/2026-10-17-routelink-website-design.md](../docs/superpowers/specs/2026-10-17-routelink-website-design.md).

```bash
python -m pip install pillow
python website/build.py                       # -> website/dist (git-ignored)
python -m http.server 4321 --directory website/dist
python website/build.py --no-images           # after editing src/: skip the WebP conversion
```

- `src/index.html` holds the structure only. Every visible string is in `src/i18n/{zh,en}.json`, referenced by
  `data-i18n` (text), `data-i18n-html` (markup) or `data-i18n-attr="attr:key;…"`. The build fails when the two
  files differ in keys or `{{vars}}`, or when the page uses a key neither defines; elements with `data-i18n`
  must be empty in the source. The build fills in Chinese; `js/i18n.js` switches to English in place.
- Screenshots are not copied into the repository: the build converts `docs/screenshots` to WebP under
  `dist/media/`. In the page, `img[data-shot="ios:overview"]` picks the file for the current language and
  theme (`js/shots.js`), so new screenshots only need the usual `<platform>-<name>-<light|dark>.png` names.
- Deployment is `.github/workflows/pages.yml`. GitHub Pages also serves the router plugin feed under
  `/agent/`, and every deployment replaces the whole site, so a website deployment mirrors the live feed
  first (`mirror_feed.py`, verified against `manifest.json` and the indexes) and a plugin release
  (`openwrt-release.yml`) calls `pages.yml` with its new feed.
- The page makes one request off-site: the GitHub API for the latest release (version and direct download
  links). Without it the buttons point at the Releases page.
