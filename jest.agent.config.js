/**
 * routelinkd integration tests against the plugin test router and traffic lab
 * (scripts/agent-router.sh, scripts/agent-dev-install.sh, scripts/traffic-lab.sh).
 * Node preset (real fetch); TypeScript goes through babel-preset-expo explicitly.
 */
const babelPresetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo')] });

module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['**/test/integration/agent*.int.test.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: [babelPresetExpo] }] },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^routelink-native$': '<rootDir>/modules/routelink-native',
  },
  testTimeout: 300000,
  maxWorkers: 1,
};
