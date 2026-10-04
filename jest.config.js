/** Unit and component tests (React Native environment). */
module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/test/integration/', '/modules/routelink-native/', '/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^routelink-native$': '<rootDir>/modules/routelink-native',
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
};
