/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  collectCoverageFrom: [
    'dist/**/*.js',
    '!dist/cli/**',
    '!dist/skills/builtins/**',
  ],
  coverageThreshold: {
    global: {
      statements: 30,
      branches: 20,
      functions: 25,
      lines: 30,
    },
  },
};
