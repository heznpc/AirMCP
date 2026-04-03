# Testing & Debugging Guide

Comprehensive guide for testing, debugging, and validating AirMCP changes.

## Quick Start

```bash
npm install
npm run build
npm test                    # Jest unit tests (includes build via pretest)
npm run dev:test -- notes   # Fast dev test — in-process, single module
npm run dev:test:changed    # Dev test — only git-changed modules
npm run qa                  # Read-only QA smoke tests (macOS, ~65 tools)
npm run qa:crud             # CRUD roundtrip tests (creates real data)
```

To reproduce the full CI pipeline locally:

```bash
npm run lint && npm run build && npm test && npm run stats:check && node scripts/check-i18n.mjs
```

---

## Unit Tests (Jest)

### Running Tests

```bash
# Run all tests (pretest hook builds first)
npm test

# Equivalent manual command
node --experimental-vm-modules node_modules/.bin/jest

# Run a specific test file
npx jest --testPathPattern='config'

# Run tests matching a describe/test name
npx jest -t 'esc() injection prevention'

# Run with coverage
npx jest --coverage
```

> **Known issue:** `--experimental-vm-modules` is required because AirMCP is an ESM
> package (`"type": "module"` in package.json). The `npm test` script includes this
> flag automatically.

### Test File Location and Naming

All test files live in `tests/` and follow the pattern `<module>-scripts.test.js` or `<feature>.test.js`:

```
tests/
  scripts.test.js              # Notes script generators
  calendar-scripts.test.js     # Calendar script generators
  contacts-scripts.test.js     # Contacts script generators
  config.test.js               # Config parsing, module enable/disable
  validate.test.js             # File path validation (zFilePath)
  semaphore.test.js            # Concurrency semaphore
  store.test.js                # Vector store
  swift.test.js                # Swift bridge detection
  hitl-guard.test.js           # Human-in-the-loop guard
  cross-tools.test.js          # Cross-module tool interactions
  semantic.test.js             # Semantic search
  ...
```

### Test Patterns

Tests import from `dist/` (the compiled output), not `src/`:

```javascript
import { describe, test, expect } from '@jest/globals';
import { listNotesScript, createNoteScript } from '../dist/notes/scripts.js';
```

**Script generation tests** -- verify JXA scripts contain expected fragments:

```javascript
test('listNotesScript with folder', () => {
  const script = listNotesScript(200, 0, 'Work');
  expect(script).toContain("whose({name: 'Work'})");
});
```

**Injection prevention tests** -- verify `esc()` handles special characters:

```javascript
test('escapes single quotes in folder name', () => {
  const script = listNotesScript(200, 0, "it's a test");
  expect(script).toContain("it\\'s a test");
  expect(script).not.toContain("it's a test");
});
```

**Infrastructure tests** -- verify runtime utilities (Semaphore, config parsing, validation):

```javascript
test('allows up to maxConcurrent slots', async () => {
  const sem = new Semaphore(2);
  // ... verify concurrency limits
});
```

**Mock-based tests** -- save/restore environment variables between tests:

```javascript
beforeEach(() => { saveEnv(); clearConfigEnv(); });
afterEach(() => { restoreEnv(); });
```

### Jest Configuration

From `jest.config.js`:

```javascript
export default {
  testEnvironment: 'node',
  transform: {},
  collectCoverageFrom: [
    'dist/**/*.js',
    '!dist/cli/**',
    '!dist/skills/builtins/**',
  ],
  coverageThresholds: {
    global: { statements: 30, branches: 20, functions: 25, lines: 30 },
  },
};
```

---

## QA Test Suites (Manual, macOS Only)

QA tests launch the real MCP server and call tools over stdio. They require macOS with the relevant Apple apps available.

### `npm run qa` -- Read-Only Smoke Tests

Exercises ~65 read-only tools. No side effects, safe to run anytime.

```bash
npm run qa                          # print report to stdout
node scripts/qa-test.mjs --out     # write to qa-report-<date>.md
node scripts/qa-test.mjs --json    # machine-readable JSON output
```

### `npm run qa:crud` -- CRUD Roundtrip

Full create, read, update, read, delete cycles. Creates real data prefixed with `[AirMCP-QA]`. Cleanup runs automatically (even on failure).

```bash
npm run qa:crud                                   # all modules
node scripts/qa-crud-test.mjs --module notes      # single module
node scripts/qa-crud-test.mjs --module notes,calendar  # multiple modules
node scripts/qa-crud-test.mjs --dry-run           # preview test plan
node scripts/qa-crud-test.mjs --out               # save report to file
node scripts/qa-crud-test.mjs --json              # JSON output
```

### `npm run qa:e2e` -- Full Coverage + Orchestration

Phase 1 calls every tool that can be auto-tested. Phase 2 runs multi-module orchestration scenarios (chaining tool outputs as inputs).

```bash
npm run qa:e2e                                    # full run (both phases)
node scripts/qa-e2e-test.mjs --phase coverage     # coverage phase only
node scripts/qa-e2e-test.mjs --phase orch         # orchestration phase only
node scripts/qa-e2e-test.mjs --dry-run            # show plan without running
node scripts/qa-e2e-test.mjs --out                # write report to file
node scripts/qa-e2e-test.mjs --json               # JSON output
```

### `npm run qa:remaining` -- File, UI, Media Tools

Covers tools skipped by the e2e suite: file operations, contacts, system toggles, screen capture, UI automation, Maps.

```bash
npm run qa:remaining                                    # full run
node scripts/qa-remaining-test.mjs --section files      # specific section only
node scripts/qa-remaining-test.mjs --no-record          # skip recording
node scripts/qa-remaining-test.mjs --dry-run            # preview only
```

### QA Status Meanings

| Status | Meaning |
|--------|---------|
| PASS   | Tool returned expected data |
| SKIP   | Expected skip (app not running, macOS version, permissions, previous step failed) |
| FAIL   | Unexpected error -- needs investigation |
| WARN   | Cleanup issue -- test data may remain |

### Including QA Results in PRs

Paste the output from `npm run qa` and `npm run qa:crud` into your PR under the **QA Report** section.

---

## Dev Test Mode (Lightweight, In-Process)

For rapid iteration during development. Uses a MockMcpServer that captures tool registrations and calls handlers directly — no child processes, no stdio transport, no JSON-RPC overhead.

### Why dev-test?

- **3x faster** than debug-pipeline / QA scripts
- **10x less memory** — no separate server processes
- **Git-aware** — `--changed` only tests modified modules
- **Watch mode** — auto rebuild + re-test on file save
- **Single-tool testing** — test one specific tool without loading everything

### Commands

```bash
npm run dev:test -- notes                  # test one module
npm run dev:test -- notes,calendar         # test specific modules
npm run dev:test:changed                   # only git-changed modules
npm run dev:test:watch -- notes            # watch mode
npm run dev:test -- --all                  # all 27 modules, sequential
npm run dev:test -- --tool list_notes      # test a single tool
npm run dev:test -- --list                 # list available modules
npm run dev:test -- --all --json           # JSON output
npm run dev:test -- --all --stop-on-fail   # stop at first failure
```

### dev:test vs debug vs qa

| Feature | `dev:test` | `debug` (debug-pipeline) | `qa:seq` |
|---------|-----------|--------------------------|----------|
| Speed | Fastest | Medium | Slowest |
| Execution | In-process (MockMcpServer) | Spawn per module | Spawn per module |
| Watch mode | Yes | No | No |
| Git-aware | Yes (`--changed`) | No | No |
| Transport | Direct handler call | Full stdio/JSON-RPC | Full stdio/JSON-RPC |
| Best for | Active development | Process-isolated debugging | Pre-PR validation |

---

## Swift Bridge Testing

### Building the Swift Bridge

```bash
npm run swift-build           # builds swift/ directory in release mode
```

This compiles the `AirMcpBridge` binary to `.build/release/AirMcpBridge`.

### Manual Testing

```bash
echo '{"text":"hello"}' | .build/release/AirMcpBridge summarize
```

### Building AirMCPKit

```bash
cd swift && swift build --target AirMCPKit
```

### Swift Bridge Detection Test

The `tests/swift.test.js` test checks whether `checkSwiftBridge()` correctly detects the binary:

```bash
npx jest --testPathPattern='swift'
```

---

## Debugging

### JXA Script Debugging

Run JXA fragments directly in the terminal:

```bash
# Quick one-liner
osascript -l JavaScript -e 'Application("Notes").notes.length'

# Multi-line script from file
osascript -l JavaScript /tmp/debug-script.js

# Verbose: log intermediate values
osascript -l JavaScript -e '
  const app = Application("Notes");
  const notes = app.notes();
  JSON.stringify({ count: notes.length, first: notes[0]?.name() });
'
```

### Permission Issues

If tools return permission errors, grant access in:

**System Settings > Privacy & Security > Automation**

Make sure your terminal app (Terminal, iTerm2, etc.) has permission to control:
- Notes, Reminders, Calendar, Contacts, Mail, Messages, Music, Safari, Finder, Photos, Shortcuts, System Events, TV

Also check:
- **Full Disk Access** -- required for some Finder operations
- **Accessibility** -- required for UI automation tools
- **Screen Recording** -- required for screen capture tools

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `--experimental-vm-modules is not available` | Node.js < 18 | Upgrade to Node.js >= 18 |
| `Cannot find module '../dist/...'` | Missing build | Run `npm run build` before `npm test` |
| `Error: Not authorized to send Apple events` | Missing Automation permission | System Settings > Privacy & Security > Automation |
| `execution error: Application isn't running` | Target app not open | Open the app (Notes, Calendar, etc.) |
| `ENOMEM` / `JavaScript heap out of memory` during `tsc` | Zod 3.25+ type explosion | Pin zod to `~3.24.0` (already pinned), or use `NODE_OPTIONS="--max-old-space-size=8192"` |
| `zod` TypeScript errors after `npm update` | Zod 3.25 breaking changes | Run `npm install zod@~3.24.0` to repin |
| `SyntaxError: Unexpected token` in JXA | Unescaped user input | Use `esc()` for strings, `escJxaShell()` for shell args in JXA |
| `CRUD test data remains after failure` | Cleanup step failed | Search for `[AirMCP-QA]` in the relevant app, delete manually |
| `License check failed` in CI | GPL dependency added | Remove the dependency or find an MIT/Apache alternative |
| `Stats check failed` | Tool count changed without updating stats | Run `npm run stats` and update `docs/index.html` |

### tsc Out-of-Memory

Known issue with Zod >= 3.25 causing TypeScript type resolution to consume excessive memory. The project pins `zod` to `~3.24.0`. If you still encounter OOM:

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run typecheck
NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

---

## CI Pipeline

CI runs on every push and PR to `main` via GitHub Actions (`macos-latest`, Node.js 22).

### Steps (in order)

1. **Checkout** -- full history (`fetch-depth: 0`)
2. **Scan for secrets** -- Gitleaks
3. **Check for large files** -- rejects files > 5 MB
4. **Setup Node.js 22** -- with npm cache
5. **Install dependencies** -- `npm ci`
6. **Check licenses** -- fails on GPL-2.0, GPL-3.0, AGPL-3.0
7. **Security audit** -- `npm audit --audit-level=high`
8. **Lint** -- `npm run lint`
9. **Build** -- `npm run build`
10. **Test** -- `npm test` (Jest with `--experimental-vm-modules`)
11. **Verify stats** -- `node scripts/count-stats.mjs --check`
12. **Verify i18n** -- `node scripts/check-i18n.mjs`

### Reproducing CI Locally

```bash
# Full pipeline (minus secrets scan and license check)
npm ci
npm run lint
npm run build
npm test
npm run stats:check
node scripts/check-i18n.mjs

# License check (requires npx)
npx license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"

# Security audit
npm audit --audit-level=high
```

---

## Adding Tests

### Where to Add

Place test files in the `tests/` directory:

- `tests/<module>-scripts.test.js` -- for JXA script generator tests
- `tests/<feature>.test.js` -- for infrastructure/utility tests

### Pattern

1. Import from `dist/` (compiled output), not `src/`
2. Use `@jest/globals` for `describe`, `test`, `expect`
3. Run `npm run build` before running tests (handled by the `pretest` script)

### Example: Script Generation Test

```javascript
import { describe, test, expect } from '@jest/globals';
import { myNewScript } from '../dist/mymodule/scripts.js';

describe('myNewScript', () => {
  test('includes expected JXA API call', () => {
    const script = myNewScript('arg1', 'arg2');
    expect(script).toContain('Application("MyApp")');
    expect(script).toContain('JSON.stringify');
  });

  test('escapes special characters in user input', () => {
    const script = myNewScript("it's dangerous");
    expect(script).toContain("it\\'s dangerous");
    expect(script).not.toContain("it's dangerous");
  });
});
```

### Example: Adding a CRUD QA Test

Add an entry to `CRUD_MODULES` in `scripts/qa-crud-test.mjs`:

```javascript
{
  name: "MyModule",
  steps: async function* (ctx) {
    yield {
      action: "create",
      tool: "create_thing",
      args: { name: "[AirMCP-QA] Test " + Date.now() },
      validate: (r) => { ctx.set("id", r.id); return !!r.id; },
    };
    yield {
      action: "read",
      tool: "list_things",
      args: {},
      validate: (r) => r.things?.some(t => t.id === ctx.get("id")),
    };
    yield {
      action: "update",
      tool: "update_thing",
      args: () => ({ id: ctx.get("id"), name: "[AirMCP-QA] Updated" }),
      validate: (r) => r.updated === true,
    };
    yield {
      action: "delete",
      tool: "delete_thing",
      args: () => ({ id: ctx.get("id") }),
      cleanup: true,   // runs even if earlier steps fail
    };
  },
}
```

Key points:
- Use `ctx.set(key, value)` / `ctx.get(key)` to pass data between steps
- Use `args: () => ({...})` (function form) when args depend on earlier steps
- Mark the final step `cleanup: true` so it runs even on failure
- Always prefix test data with `[AirMCP-QA]`

---

## Cleanup

### QA Test Cleanup

All QA scripts handle cleanup automatically. CRUD and e2e tests use try/finally to ensure cleanup steps run even when earlier steps fail.

### Manual Cleanup

If a QA run is interrupted or cleanup fails, search for test data in the relevant apps:

- **Notes** -- search for `[AirMCP-QA]` or `[AirMCP-E2E]`
- **Reminders** -- search for `[AirMCP-QA]`
- **Calendar** -- search for `[AirMCP-QA]` events
- **Contacts** -- search for `[AirMCP-QA]`
- **Files** -- check `/tmp` for files prefixed with `AirMCP-QA`

Delete any leftover test data manually.
