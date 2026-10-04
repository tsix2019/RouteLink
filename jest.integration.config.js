/** Integration tests against a real OpenWrt (Docker locally, QEMU in CI). Needs ROUTER_URL / ROUTER_PASSWORD. */
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['<rootDir>/test/integration/**/*.int.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^routelink-native$': '<rootDir>/modules/routelink-native',
  },
  testTimeout: 180000,
  maxWorkers: 1,
};
