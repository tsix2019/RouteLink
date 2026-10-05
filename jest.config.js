/** Unit and component tests (React Native environment). */

// One time zone for every run (a test cannot change it: Jest hands tests a copy of process.env), so
// date tests give the same results on a laptop in any zone and in CI.
process.env.TZ = 'Asia/Shanghai';

module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/test/integration/', '/modules/routelink-native/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^routelink-native$': '<rootDir>/modules/routelink-native',
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
};
