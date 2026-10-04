// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'android/*',
      'ios/*',
      'build/*',
      'modules/**/android/build/*',
      'test/integration/.cache/*',
      // LuCI modules (top-level return, LuCI globals), not app code
      'openwrt/luci-app-routelink/htdocs/**',
    ],
  },
]);
