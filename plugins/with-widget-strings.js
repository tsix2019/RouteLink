// The Android widgets' names, descriptions and previews in the widget picker, in English and Chinese (design
// §19). react-native-android-widget writes its label into the manifest and its description into values/ as
// they are given; app.config.ts gives them as references to the strings written here, from the app's own
// texts (src/i18n/locales/*/common.json, widget.kinds). Its preview image (English) goes to drawable/; the
// Chinese one, assets/images/widget-preview-zh-<key>.png, goes to drawable-zh/ under the same name.
// Also lets the app open MIUI's permission editor, where the "home screen shortcuts" permission that
// adding a widget from the app needs is switched on (src/widgets/pin.ts): Android 11+ only resolves
// another app's activity when the manifest declares it in <queries>.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const MIUI_PERMISSIONS = 'miui.intent.action.APP_PERM_EDITOR';
const FILE = 'routelink_widgets.xml';
/** Widget class → key, as in app.config.ts and src/widgets/catalog.ts. */
const WIDGETS = {
  RouterWidget: 'router',
  SpeedWidget: 'speed',
  DevicesWidget: 'devices',
  SystemWidget: 'system',
  WanWidget: 'wan',
  ShortcutsWidget: 'shortcuts',
};

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"');

function resources(projectRoot, lang) {
  const file = path.join(projectRoot, 'src/i18n/locales', lang, 'common.json');
  const kinds = JSON.parse(fs.readFileSync(file, 'utf8')).widget.kinds;
  const strings = Object.entries(kinds).flatMap(([key, k]) => [
    `  <string name="routelink_widget_${key}_label">${escape(k.name)}</string>`,
    `  <string name="routelink_widget_${key}_description">${escape(k.description)}</string>`,
  ]);
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${strings.join('\n')}\n</resources>\n`;
}

function withStrings(config) {
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const res = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res');
      for (const [dir, lang] of [
        ['values', 'en'],
        ['values-zh', 'zh-CN'],
      ]) {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        fs.writeFileSync(path.join(res, dir, FILE), resources(c.modRequest.projectRoot, lang));
      }
      fs.mkdirSync(path.join(res, 'drawable-zh'), { recursive: true });
      for (const [name, key] of Object.entries(WIDGETS)) {
        fs.copyFileSync(
          path.join(c.modRequest.projectRoot, `assets/images/widget-preview-zh-${key}.png`),
          path.join(res, 'drawable-zh', `${name.toLowerCase()}_preview.png`),
        );
      }
      return c;
    },
  ]);
}

function withMiuiQuery(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const queries = manifest.queries[0];
    queries.intent = queries.intent ?? [];
    const declared = queries.intent.some((i) => i.action?.some((a) => a.$['android:name'] === MIUI_PERMISSIONS));
    if (!declared) queries.intent.push({ action: [{ $: { 'android:name': MIUI_PERMISSIONS } }] });
    return c;
  });
}

module.exports = function withWidgetStrings(config) {
  return withMiuiQuery(withStrings(config));
};
