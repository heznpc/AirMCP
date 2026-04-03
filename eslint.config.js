import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// ── shared/ layer definitions for import-boundary enforcement ──
// Layer 1 — Core  (no internal deps)
// Layer 2 — Bridge (may import Core only)
// Layer 3 — Services (may import Core + Bridge)

const LAYER2_BRIDGE = [
  'hitl-guard', 'hitl',
  'tool-filter', 'tool-search', 'share-guard',
];

const LAYER3_SERVICES = [
  'tool-registry', 'usage-tracker', 'audit', 'event-bus', 'cache',
  'proactive', 'swift', 'jxa', 'resources', 'setup', 'tool-links',
];

/** Build a no-restricted-imports paths array from a list of module basenames. */
function forbidden(modules, layerLabel) {
  return modules.flatMap((m) => [
    { name: `./${m}.js`, message: `Layer violation: cannot import ${layerLabel} module "${m}" from this layer.` },
    { name: `./${m}`, message: `Layer violation: cannot import ${layerLabel} module "${m}" from this layer.` },
    { name: `./${m}.ts`, message: `Layer violation: cannot import ${layerLabel} module "${m}" from this layer.` },
  ]);
}

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,

  // ── Layer 1 — Core: must NOT import from Bridge or Services ──
  {
    files: [
      'src/shared/constants.ts',
      'src/shared/config.ts',
      'src/shared/mcp.ts',
      'src/shared/registry.ts',
      'src/shared/icons.ts',
      'src/shared/banner.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          ...forbidden(LAYER2_BRIDGE, 'Bridge (Layer 2)'),
          ...forbidden(LAYER3_SERVICES, 'Services (Layer 3)'),
        ],
      }],
    },
  },

  // ── Layer 2 — Bridge: must NOT import from Services ──
  {
    files: [
      'src/shared/hitl-guard.ts',
      'src/shared/hitl.ts',
      'src/shared/tool-filter.ts',
      'src/shared/share-guard.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          ...forbidden(LAYER3_SERVICES, 'Services (Layer 3)'),
        ],
      }],
    },
  },

  {
    ignores: ['dist/', 'tests/', 'jest.config.js', 'eslint.config.js'],
  }
);
