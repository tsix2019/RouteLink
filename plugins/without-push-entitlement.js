// RouteLink only shows local notifications (design §19), which need no push entitlement. expo-notifications
// adds `aps-environment` anyway, and it can stop people from signing the unsigned IPA with a free Apple ID.
// expo-notifications is applied before any listed plugin (Expo's own plugins come first), so an ordinary
// entitlements mod here would run too early: this one edits the written file at the very end instead.
const fs = require('fs');
const { IOSConfig, withFinalizedMod } = require('expo/config-plugins');
const plist = require('@expo/plist').default;

module.exports = function withoutPushEntitlement(config) {
  return withFinalizedMod(config, [
    'ios',
    async (c) => {
      const file = IOSConfig.Entitlements.getEntitlementsPath(c.modRequest.projectRoot);
      if (file && fs.existsSync(file)) {
        const entitlements = plist.parse(fs.readFileSync(file, 'utf8'));
        if ('aps-environment' in entitlements) {
          delete entitlements['aps-environment'];
          fs.writeFileSync(file, plist.build(entitlements));
        }
      }
      return c;
    },
  ]);
};
