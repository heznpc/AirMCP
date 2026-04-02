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
      statements: 35,
      branches: 25,
      functions: 30,
      lines: 35,
    },
  },
};
