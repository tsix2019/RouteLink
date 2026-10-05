/** Integration tests against a real OpenWrt (Docker locally, QEMU in CI). Needs ROUTER_URL / ROUTER_PASSWORD. */
module.exports = {
  preset: 'jest-expo/node',
  // The node preset leaves Babel unconfigured when there is no babel.config.js: use Expo's preset.
  transform: {
    '\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [require.resolve('expo/internal/babel-preset')],
        caller: { name: 'metro', bundler: 'metro', platform: 'web', isServer: true },
      },
    ],
  },
  // Only look in here: in CI mode the unit tests' snapshot files would count as obsolete and fail the run.
  roots: ['<rootDir>/test/integration'],
  testMatch: ['<rootDir>/test/integration/**/*.int.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^routelink-native$': '<rootDir>/modules/routelink-native',
  },
  testTimeout: 180000,
  maxWorkers: 1,
};
