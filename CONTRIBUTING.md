# Contributing to AirMCP

Thanks for your interest in contributing to AirMCP! This guide covers everything you need to get started.

## Development Setup

```bash
git clone https://github.com/heznpc/AirMCP.git
cd AirMCP
npm install
npm run build
```

### Requirements

- macOS (required — Apple app automation only works on macOS)
- Node.js >= 18
- For Swift bridge features: macOS 26+ with Apple Silicon

### Running Locally

```bash
# stdio mode (default)
npm start

# HTTP mode
node dist/index.js --http --port 3847

# Development with auto-reload
npm run dev
```

## Branch Strategy

- **`main`** is the production branch — always deployable
- Create feature branches from `main`
- All changes to `main` must go through a Pull Request
- PRs require CI to pass before merging

### Branch Naming

```
feat/short-description    # new feature
fix/short-description     # bug fix
docs/short-description    # documentation only
refactor/short-description # code refactoring
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feat/my-feature
```

### 2. Write Code

**Project structure** — each Apple app is a module under `src/`:

```
src/
├── notes/          # tools.ts, scripts.ts, prompts.ts
├── reminders/
├── calendar/
├── ...
├── shared/         # esc.ts, config.ts, setup.ts, resources.ts
└── index.ts        # server entry point
```

**Key patterns:**
- `scripts.ts` — JXA script generators (pure functions returning strings)
- `tools.ts` — MCP tool registrations (use `server.tool()`)
- `prompts.ts` — MCP prompt registrations (use `server.prompt()`)
- Always use `esc()` for JXA string interpolation and `escJxaShell()` for shell arguments inside JXA

### 3. Validate

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript type checking
npm run build      # Full build
npm test           # Jest tests
```

All four must pass — CI runs them automatically on every PR.

### 4. Run QA Tests

**Sequential QA (recommended)** — tests each module in isolation, one at a time. Starts a server with only one module enabled, runs its tools, kills the server, then moves to the next. Much lighter on system resources:

```bash
npm run qa:seq                             # test all modules sequentially
node scripts/qa-sequential.mjs notes       # test a single module
node scripts/qa-sequential.mjs notes calendar reminders  # test specific modules
node scripts/qa-sequential.mjs --out       # save report to file
```

**Full smoke test** — loads all modules at once (resource-intensive):

```bash
npm run qa                         # run all 61 read-only tool tests
node scripts/qa-test.mjs --out     # save to qa-report-<date>.md
node scripts/qa-test.mjs --json    # machine-readable JSON output
```

**CRUD roundtrip test** — full create → read → update → read → delete cycles:

```bash
npm run qa:crud                              # run all CRUD modules
node scripts/qa-crud-test.mjs --module notes # single module only
node scripts/qa-crud-test.mjs --module notes,calendar  # multiple modules
node scripts/qa-crud-test.mjs --dry-run      # preview test plan
node scripts/qa-crud-test.mjs --out          # save report to file
```

CRUD tests create real data (notes, reminders, events, etc.) prefixed with `[AirMCP-QA]`. Cleanup runs automatically even if a step fails. If cleanup fails, search for `[AirMCP-QA]` in the relevant app and delete manually.

Paste the output from both tests into your PR under the **QA Report** section.

**Status meanings:**

| Status | Meaning |
|--------|---------|
| PASS | Tool returned expected data |
| SKIP | Expected skip (app not running, macOS version, permissions, previous step failed) |
| FAIL | Unexpected error — needs investigation |
| WARN | Cleanup issue — test data may remain |

### Adding a CRUD test for a new module

Open `scripts/qa-crud-test.mjs` and add an entry to `CRUD_MODULES`:

```javascript
{
  name: "MyModule",
  steps: async function* (ctx) {
    // CREATE — store the ID for later steps
    yield {
      action: "create",
      tool: "create_thing",
      args: { name: "[AirMCP-QA] Test " + Date.now() },
      validate: (r) => { ctx.set("id", r.id); return !!r.id; },
    };
    // READ — verify creation
    yield {
      action: "read",
      tool: "list_things",
      args: {},
      validate: (r) => r.things?.some(t => t.id === ctx.get("id")),
    };
    // UPDATE
    yield {
      action: "update",
      tool: "update_thing",
      args: () => ({ id: ctx.get("id"), name: "[AirMCP-QA] Updated" }),
      validate: (r) => r.updated === true,
    };
    // DELETE (cleanup: true = always runs, even after failures)
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
- Use `ctx.set(key, value)` / `ctx.get(key)` to pass data between steps
- Use `args: () => ({...})` (function) when args depend on earlier steps
- Mark the last step `cleanup: true` so it runs even if earlier steps fail
- Always prefix test data with `[AirMCP-QA]` for easy identification

### 5. Commit

Write clear, concise commit messages:

```
feat: add search_contacts tool
fix: escape single quotes in JXA chat ID
docs: update README tool count
refactor: extract shared pagination logic
```

### 6. Open a Pull Request

- Target the `main` branch
- Fill in the PR template
- Wait for CI to pass
- Request a review if needed

## Adding a New Tool

1. Add the JXA script generator to `src/<module>/scripts.ts`
2. Register the tool in `src/<module>/tools.ts` with proper safety annotations:
   - `readOnlyHint: true` for read operations
   - `destructiveHint: true` for delete/update operations
3. Add tests for script generators in `tests/<module>-scripts.test.js`
4. Run `npm run stats` to verify counts, then update `docs/index.html` if needed

## Adding a New Module

1. Create `src/<module>/scripts.ts` and `src/<module>/tools.ts`
   - `tools.ts` must export a function named `register<Module>Tools(server, config)`
2. Add one line to the `MANIFEST` array in `src/shared/modules.ts` — no other imports needed
3. Add prompts if applicable (`src/<module>/prompts.ts`, set `hasPrompts: true` in MANIFEST)
4. Add tests in `tests/<module>-scripts.test.js`
5. Verify with `node scripts/qa-sequential.mjs <module>`
6. Update all documentation (README, landing page)

## Code Style

- TypeScript strict mode
- ESLint enforced — run `npm run lint` before committing
- No `any` types — use `unknown` and narrow
- Prefer `const` over `let`
- Use the shared `esc()` / `escJxaShell()` utilities — never inline string escaping

## Security

- **Never** interpolate user input directly into JXA scripts — always use `esc()` or `escJxaShell()`
- Every tool must have `annotations` with `readOnlyHint` or `destructiveHint`
- Destructive tools should validate input before executing

## Questions?

Open an [issue](https://github.com/heznpc/AirMCP/issues) for bugs, feature requests, or questions.
