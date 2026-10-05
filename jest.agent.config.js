/**
 * routelinkd integration tests against the plugin test router and traffic lab
 * (scripts/agent-router.sh, scripts/agent-dev-install.sh, scripts/traffic-lab.sh).
 * Node preset (real fetch); TypeScript goes through babel-preset-expo explicitly.
 */
const babelPresetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo')] });

module.exports = {
  preset: 'jest-expo/node',
  // own folder and suffix: the general integration config (test/integration) must not pick these up
  // Only look in here: in CI mode the unit tests' snapshot files would count as obsolete and fail the run.
  roots: ['<rootDir>/test/agent'],
  testMatch: ['**/test/agent/*.agent.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: [babelPresetExpo] }] },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^routelink-native$': '<rootDir>/modules/routelink-native',
  },
  testTimeout: 300000,
  maxWorkers: 1,
};
