/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  // Stale git worktrees under `.claude/worktrees/*/` and the generated
  // `build/` bundle (build/mcpb/server/package.json) ship their own
  // package.json, which causes jest-haste-map to throw on duplicate module
  // names (`Cannot find module 'name'`) and jest's test discovery to run
  // pre-rebase versions of every suite. `testPathIgnorePatterns` only filters
  // discovery; `modulePathIgnorePatterns` is what suppresses haste scanning.
  // Both are needed.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/build/'],
  modulePathIgnorePatterns: ['/\\.claude/', '/build/'],
  collectCoverageFrom: [
    'dist/**/*.js',
    '!dist/cli/**',
    '!dist/skills/builtins/**',
  ],
  coverageThreshold: {
    global: {
      statements: 46,
      branches: 40,
      functions: 42,
      lines: 46,
    },
  },
};
