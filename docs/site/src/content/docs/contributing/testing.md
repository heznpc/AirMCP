---
title: Testing & Debugging
description: Complete guide to running tests, debugging failures, and adding new tests to AirMCP.
---

AirMCP has three testing layers: Jest unit tests for script generation and shared utilities, QA integration tests that exercise tools against real macOS apps, and manual testing for destructive or side-effect-heavy operations.

## Running Unit Tests

Unit tests use [Jest](https://jestjs.io/) with ESM support. The test files live in the `tests/` directory and import from the compiled `dist/` output.

### Run all tests

```bash
NODE_OPTIONS="--experimental-vm-modules" npx jest
```

Or use the npm script (which sets the flag automatically):

```bash
npm test
```

Note: `npm test` runs `npm run pretest` first, which compiles TypeScript via `tsc`. If you only changed test files and `dist/` is up to date, you can skip the build step by running Jest directly.

### Run a single test file

```bash
NODE_OPTIONS="--experimental-vm-modules" npx jest tests/scripts.test.js
```

### Run tests matching a pattern

```bash
NODE_OPTIONS="--experimental-vm-modules" npx jest --testPathPattern="calendar"
```

### Watch mode

```bash
NODE_OPTIONS="--experimental-vm-modules" npx jest --watchAll
```

Watch mode reruns tests when files change. Useful during development, but remember that tests import from `dist/`, so you need `tsc` running in another terminal or use `npm run build` before each change takes effect.

## Test Structure

### Directory layout

```
tests/
├── scripts.test.js            # Notes script generators
├── calendar-scripts.test.js   # Calendar script generators
├── contacts-scripts.test.js   # Contacts script generators
├── reminders-scripts.test.js  # Reminders script generators
├── mail-scripts.test.js       # Mail script generators
├── messages-scripts.test.js   # Messages script generators
├── music-scripts.test.js      # Music script generators
├── finder-scripts.test.js     # Finder script generators
├── safari-scripts.test.js     # Safari script generators
├── system-scripts.test.js     # System script generators
├── photos-scripts.test.js     # Photos script generators
├── podcasts-scripts.test.js   # Podcasts script generators
├── tv-scripts.test.js         # TV script generators
├── maps-scripts.test.js       # Maps script generators
├── maps-api.test.js           # Maps HTTP API calls
├── screen-scripts.test.js     # Screen capture script generators
├── ui-scripts.test.js         # UI automation script generators
├── shortcuts-scripts.test.js  # Shortcuts script generators
├── shortcuts-dynamic.test.js  # Dynamic shortcut tool registration
├── config.test.js             # Config parsing and env var handling
├── cross-tools.test.js        # Cross-module tool tests
├── resources.test.js          # MCP resource registration
├── semantic.test.js           # Semantic search / vector store
├── semaphore.test.js          # Concurrency semaphore
├── validate.test.js           # Input validation utilities
├── store.test.js              # Vector store persistence
├── swift.test.js              # Swift bridge invocation
└── hitl-guard.test.js         # Human-in-the-loop guard
```

### ESM and mocking

Tests use native ESM (`import`/`export`). For mocking, use `jest.unstable_mockModule` instead of `jest.mock`:

```javascript
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock must be set up BEFORE importing the module under test
jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: jest.fn().mockResolvedValue('{"notes":[]}'),
}));

// Dynamic import AFTER mock setup
const { listNotesScript } = await import('../dist/notes/scripts.js');
```

### Script generation tests

Most test files verify that JXA script generator functions produce correct JavaScript strings. They do not execute the scripts -- they check that the generated code contains expected patterns:

```javascript
test('listNotesScript with folder', () => {
  const script = listNotesScript(200, 0, 'Work');
  expect(script).toContain("whose({name: 'Work'})");
});
```

This pattern ensures that parameter interpolation, escaping, and logic branches work correctly without needing a running macOS app.

## QA Test Suites

QA tests are integration tests that start the full MCP server, send JSON-RPC requests, and exercise tools against real macOS applications. They live in `scripts/` and are run via npm scripts.

### Read-only smoke test

```bash
npm run qa
```

Runs `scripts/qa-test.mjs`. Exercises every read-only tool across all 29 modules. Does not modify any data. Safe to run anytime. Outputs a Markdown report with PASS/SKIP/FAIL status per tool.

### CRUD roundtrip test

```bash
npm run qa:crud
```

Runs `scripts/qa-crud-test.mjs`. Tests full create-read-update-delete cycles for writable modules (Notes, Reminders, Calendar, Contacts, System, Finder, Safari, Pages, Numbers, Keynote, Music). Test data is prefixed with `[AirMCP-QA]` for identification. Cleanup steps run even if earlier steps fail.

### Full E2E coverage test

```bash
npm run qa:e2e
```

Runs `scripts/qa-e2e-test.mjs`. Two-phase test:
1. **Coverage phase** -- calls every tool that can be safely auto-tested (both read and write operations with cleanup)
2. **Orchestration phase** -- multi-module scenarios that chain tool outputs as inputs (e.g., create a note, search for it, then delete it)

### Remaining tools test

```bash
npm run qa:remaining
```

Runs `scripts/qa-remaining-test.mjs`. Covers tools skipped by the E2E test, including file operations in `/tmp`, system toggles with restore, screen captures with cleanup, UI automation, and Maps interactions.

## QA Script Flags

All QA scripts support these common flags:

| Flag | Description |
|------|-------------|
| `--json` | Output results as machine-readable JSON instead of Markdown |
| `--out` | Write report to a file (`qa-report-<date>.md` or `.json`) instead of stdout |
| `--dry-run` | Show the test plan without executing any tools |

Additional flags for specific scripts:

| Flag | Script | Description |
|------|--------|-------------|
| `--module notes,calendar` | `qa:crud` | Run only specified modules (comma-separated) |
| `--phase coverage` | `qa:e2e` | Run only the coverage phase |
| `--phase orch` | `qa:e2e` | Run only the orchestration phase |
| `--section files` | `qa:remaining` | Run only a specific section |
| `--no-record` | `qa:remaining` | Skip screen recording tests |
| `--skip toolname` | `qa:e2e` | Skip specific tools |

### Examples

```bash
# Read-only smoke test with JSON output
npm run qa -- --json

# CRUD test for just Notes and Calendar
npm run qa:crud -- --module notes,calendar

# E2E coverage only, write report to file
npm run qa:e2e -- --phase coverage --out

# See what the CRUD test would do without running it
npm run qa:crud -- --dry-run
```

## Debugging Failed Tests

### Common unit test issues

**`SyntaxError: Cannot use import statement outside a module`**

Jest needs the `--experimental-vm-modules` flag for ESM. Make sure you are running:

```bash
NODE_OPTIONS="--experimental-vm-modules" npx jest
```

Or use `npm test` which sets this automatically.

**`Cannot find module '../dist/notes/scripts.js'`**

The `dist/` directory is missing or stale. Run the build first:

```bash
npm run build
```

**TypeScript compilation OOM (`JavaScript heap out of memory`)**

This is a known issue caused by `zod@3.25+`. AirMCP pins zod to `~3.24.0` to avoid it. If you see OOM during `tsc`, check that your `node_modules/zod` version is 3.24.x:

```bash
node -e "console.log(require('zod/package.json').version)"
```

If it is 3.25+, remove `node_modules` and reinstall:

```bash
rm -rf node_modules && npm install
```

### Common QA test issues

**`SKIP -- App not running / not installed`**

The tool requires its target app (e.g., Safari, Music, Pages) to be running. Open the app and retry. Some tools like Podcasts may be broken on newer macOS versions due to scripting dictionary changes.

**`SKIP -- Needs macOS permission`**

macOS denied automation access. Open **System Settings > Privacy & Security > Automation** and grant permission to your terminal app (Terminal, iTerm2, Warp, etc.) for the target application.

**`SKIP -- Requires Swift bridge / macOS 26+`**

Either:
- The Swift bridge binary has not been built. Run: `npm run swift-build`
- The tool requires macOS 26 (Tahoe) or later, and you are on an earlier version.

**`FAIL -- JXA API incompatible (scripting dictionary changed)`**

Apple sometimes changes or removes scripting APIs between macOS versions. The JXA error code `-1708` means "event not handled." This typically indicates the app's AppleScript/JXA dictionary has changed. File a GitHub issue with the macOS version and tool name.

**`ERROR -- Timeout (no response)`**

The MCP server did not respond within 15 seconds. Common causes:
- The app is displaying a modal dialog (e.g., "Allow access?")
- The system is under heavy load
- JXA concurrency limit is reached (increase `AIRMCP_JXA_CONCURRENCY` or wait)

### Checking macOS permissions

To verify that your terminal has the necessary permissions:

1. Open **System Settings** (or System Preferences on older macOS)
2. Go to **Privacy & Security > Automation**
3. Find your terminal app and ensure checkboxes are enabled for the apps you want to automate
4. Also check **Privacy & Security > Accessibility** if UI automation tools fail

You can also run the built-in doctor command:

```bash
npx airmcp doctor
```

This checks Node.js version, macOS version, installed MCP clients, module availability, and common permission issues.

## Testing JXA Scripts in Isolation

When debugging a specific JXA script, you can run it directly with `osascript` without starting the full MCP server:

```bash
# List notes (first 5)
osascript -l JavaScript -e '
  const Notes = Application("Notes");
  const notes = Notes.notes();
  const result = notes.slice(0, 5).map(n => ({
    id: n.id(), name: n.name()
  }));
  JSON.stringify(result);
'
```

```bash
# Check if an app is running
osascript -l JavaScript -e '
  Application("System Events").processes.whose({
    name: "Safari"
  })().length > 0;
'
```

```bash
# Get clipboard content
osascript -l JavaScript -e '
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.theClipboard();
'
```

You can also extract the generated script from a test and run it:

```javascript
// In a test or Node REPL:
import { listNotesScript } from './dist/notes/scripts.js';
console.log(listNotesScript(5, 0));
// Copy the output and run it with osascript -l JavaScript -e '...'
```

## Swift Bridge Testing

### Building the Swift bridge

```bash
npm run swift-build
# or directly:
cd swift && swift build -c release
```

The binary is output to `swift/.build/release/AirMcpBridge`.

### Manual testing

The Swift bridge reads JSON commands from stdin and writes JSON responses to stdout. Test it by piping JSON:

```bash
# Check embedding capability
echo '{"action":"embed","text":"hello world"}' | swift/.build/release/AirMcpBridge

# Check spotlight search
echo '{"action":"spotlight","query":"test","limit":5}' | swift/.build/release/AirMcpBridge
```

### Unit tests for Swift bridge

The `tests/swift.test.js` file tests the Node.js side of Swift bridge invocation -- it mocks the child process and verifies command formatting and response parsing. It does not compile or run the actual Swift binary.

## Adding New Tests

### Where to add tests

- **Script generator tests**: Create `tests/<module>-scripts.test.js` following the existing pattern. Import from `dist/<module>/scripts.js` and verify the generated JXA string contains expected patterns.
- **Tool registration tests**: Add to `tests/<module>-tools.test.js` if you need to verify tool metadata, input schema validation, or error handling.
- **QA integration tests**: Add entries to the test plan arrays in the appropriate `scripts/qa-*.mjs` file.

### Naming conventions

- Unit test files: `tests/<module>-<aspect>.test.js` (e.g., `tests/calendar-scripts.test.js`)
- QA scripts: `scripts/qa-<category>-test.mjs`
- Test data prefix: `[AirMCP-QA]` for CRUD tests, `[AirMCP-E2E]` for E2E tests

### Script generation test pattern

Follow this pattern when adding tests for a new module's script generators:

```javascript
import { describe, test, expect } from '@jest/globals';
import {
  listThingsScript,
  createThingScript,
} from '../dist/mymodule/scripts.js';

describe('mymodule script generators', () => {
  test('listThingsScript includes limit', () => {
    const script = listThingsScript(10);
    expect(script).toContain('slice(0, 10)');
    expect(script).toContain('JSON.stringify');
  });

  test('createThingScript escapes single quotes in name', () => {
    const script = createThingScript("O'Brien");
    expect(script).toContain("O\\'Brien");
  });
});
```

### Adding a QA CRUD module test

Add an entry to the `CRUD_MODULES` array in `scripts/qa-crud-test.mjs`:

```javascript
{
  name: "MyModule",
  steps: async function* (ctx) {
    yield {
      action: "create",
      tool: "create_thing",
      args: { name: QA_PREFIX + " Test " + TS },
      validate: (r) => { ctx.set("id", r.id); return !!r.id; },
    };
    yield {
      action: "read",
      tool: "list_things",
      args: {},
      validate: (r) => r.things?.some(t => t.id === ctx.get("id")),
    };
    yield {
      action: "delete",
      tool: "delete_thing",
      args: () => ({ id: ctx.get("id") }),
      cleanup: true,
    };
  },
}
```

Key points:
- Use `ctx.set()` / `ctx.get()` to pass data between steps (IDs, names)
- Mark the final cleanup step with `cleanup: true` -- it runs even if earlier steps fail
- Use function-style `args: () => ({...})` when args depend on previous step results
- The `validate` callback receives parsed JSON from the tool response

## CI Pipeline

### What CI runs

The CI pipeline executes:

1. `npm run lint` -- ESLint on `src/`
2. `npm run typecheck` -- TypeScript type checking (`tsc --noEmit`)
3. `npm test` -- Jest unit tests with `--experimental-vm-modules`

CI does **not** run QA integration tests (`qa`, `qa:crud`, `qa:e2e`) because they require a running macOS desktop environment with app access and permissions.

### Reproducing CI locally

```bash
# Run the same checks CI does:
npm run lint && npm run typecheck && npm test
```

If all three pass locally, your PR should pass CI.

### Pre-commit hooks

AirMCP uses Husky + lint-staged. On commit, it runs:
- `eslint --fix` on changed `.ts` files in `src/`
- `tsc --noEmit --skipLibCheck` on changed `.ts` files

If the pre-commit hook fails, fix the lint/type errors before committing.

## Common Troubleshooting

### `tsc` runs out of memory (OOM)

Known issue with `zod@3.25+` and TypeScript. AirMCP pins `zod` to `~3.24.0`. If you see:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

Check your zod version and reinstall if needed:

```bash
node -e "console.log(require('zod/package.json').version)"
# If 3.25+:
rm -rf node_modules && npm install
```

### ESM import errors in tests

If you see errors like `ERR_MODULE_NOT_FOUND` or `ERR_UNKNOWN_FILE_EXTENSION`:

1. Make sure `dist/` is up to date: `npm run build`
2. Make sure you are using `NODE_OPTIONS="--experimental-vm-modules"`
3. Verify the test imports from `../dist/` (compiled JS), not `../src/` (TypeScript)

### Permission denied errors

If JXA scripts fail with "not authorized" or "permission denied":

1. Open **System Settings > Privacy & Security > Automation**
2. Grant your terminal permission for the target app
3. You may need to restart your terminal after granting permissions
4. For Accessibility-based tools (UI module), also check **Privacy & Security > Accessibility**

### `osascript` timeout

If individual JXA calls hang:

1. Check if the target app is showing a dialog or prompt
2. Try running the app manually and dismissing any dialogs
3. Increase the timeout: `AIRMCP_TIMEOUT_JXA=60000 npm test`
4. Check Activity Monitor for stuck `osascript` processes and kill them

## Cleanup After Tests

### CRUD test data

CRUD tests create data prefixed with `[AirMCP-QA]`. The test runner attempts automatic cleanup, but if a test was interrupted, leftover data may remain:

- **Notes**: Search for notes titled `[AirMCP-QA]` in Apple Notes and delete them
- **Reminders**: Search for reminders titled `[AirMCP-QA]` and delete them
- **Calendar**: Look for events titled `[AirMCP-QA]` in the Calendar app and delete them
- **Contacts**: Search for contacts named "AirMcpQA" and delete them
- **Finder**: Check `~/Desktop/` for directories named `airmcp-qa-*` and trash them
- **Notes folders**: Look for folders named `[AirMCP-QA] Folder` (no delete_folder tool exists, so delete manually)
- **Music playlists**: Look for playlists named `[AirMCP-QA] Playlist` and delete them

### E2E test data

E2E tests use the prefix `[AirMCP-E2E]`. Same cleanup strategy as CRUD tests.

### Quick cleanup script

You can use the MCP server itself to find and clean up test data:

```bash
# Start the server with all modules
AIRMCP_FULL=true npx airmcp

# Then ask your AI assistant:
# "Search for notes, reminders, and calendar events containing 'AirMCP-QA' and delete them"
```

Or use JXA directly:

```bash
# Find and delete QA notes
osascript -l JavaScript -e '
  const Notes = Application("Notes");
  const qaNotes = Notes.notes.whose({name: {_contains: "AirMCP-QA"}})();
  qaNotes.forEach(n => Notes.delete(n));
  qaNotes.length + " notes deleted";
'

# Find and delete QA reminders
osascript -l JavaScript -e '
  const Rem = Application("Reminders");
  const qaRems = Rem.reminders.whose({name: {_contains: "AirMCP-QA"}})();
  qaRems.forEach(r => Rem.delete(r));
  qaRems.length + " reminders deleted";
'
```
