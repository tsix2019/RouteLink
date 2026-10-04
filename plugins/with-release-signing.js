// Release signing from environment variables (CI secrets), never from files in the repo.
// RL_KEYSTORE_FILE, RL_KEYSTORE_PASSWORD, RL_KEY_ALIAS, RL_KEY_PASSWORD — when any is missing the
// release build falls back to the debug key, so local `assembleRelease` keeps working.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// routelink: release signing';

const SIGNING_CONFIG = `
        release {
            ${MARKER}
            def rlStore = System.getenv('RL_KEYSTORE_FILE')
            if (rlStore) {
                storeFile file(rlStore)
                storePassword System.getenv('RL_KEYSTORE_PASSWORD')
                keyAlias System.getenv('RL_KEY_ALIAS')
                keyPassword System.getenv('RL_KEY_PASSWORD') ?: System.getenv('RL_KEYSTORE_PASSWORD')
            }
        }`;

const RL_ENV = ['RL_KEYSTORE_FILE', 'RL_KEYSTORE_PASSWORD', 'RL_KEY_ALIAS'];

function addSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  // 1. A release signing config next to the debug one.
  let out = gradle.replace(/signingConfigs\s*\{\s*\n(\s*)debug\s*\{/, (m) =>
    m.replace(/debug\s*\{$/, `${SIGNING_CONFIG.trimStart()}\n        debug {`),
  );
  if (out === gradle) throw new Error('with-release-signing: signingConfigs block not found');
  // 2. The release build type uses it when the environment provides a keystore.
  const condition = RL_ENV.map((v) => `System.getenv('${v}')`).join(' && ');
  const before = out;
  out = out.replace(
    /(release\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/,
    // Parenthesised call: Groovy would read `signingConfig (a) ? b : c` as `signingConfig(a) ? b : c`.
    `$1signingConfig((${condition}) ? signingConfigs.release : signingConfigs.debug)`,
  );
  if (out === before) throw new Error('with-release-signing: release buildType signingConfig not found');
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addSigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.addSigning = addSigning;
