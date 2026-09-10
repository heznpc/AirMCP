/**
 * Universal runtime error contract — every module tool, mechanically.
 *
 * RFC 0013 warns that registration-shape tests are not runtime contracts, yet
 * ~200 of 297 tools had no test that ever invoked their handler. This harness
 * closes that gap without per-tool fixtures: it registers every module from
 * MODULE_MANIFEST, synthesizes valid arguments from each tool's declared
 * inputSchema, and calls every handler while all platform executors (jxa,
 * swift, automation, fetch) reject with a decorated permission-denied error —
 * the highest-frequency real-world failure (issues #28, #145).
 *
 * The contract, per tool:
 *   A. NEVER-THROW — the handler must not throw; it must return an MCP-shaped
 *      response ({ content: [{ type, text }] }).
 *   B. NO SILENT SUCCESS — if the tool consumed an executor result that was a
 *      permission failure, it must not report success (the #145 "empty but ok"
 *      bug class).
 *   C. GUIDANCE SURVIVES — the error text must carry the actionable recovery
 *      guidance from the executor (System Settings path), not a raw stack.
 *   D. CLASSIFIED — structured errors must categorize as permission_denied so
 *      clients and retry logic can react correctly.
 *
 * A ratchet closes the loop: every registered tool must either pass the
 * contract or appear in EXEMPT with a reason. New tools are covered by
 * default; exempting one is an explicit, reviewed decision.
 */
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

// ── Isolated runtime environment (before any dist import) ────────────
const SCRATCH = mkdtempSync(join(tmpdir(), 'airmcp-contract-'));
process.env.AIRMCP_RATE_LIMIT = 'false';
process.env.AIRMCP_AUDIT_LOG = 'false';
process.env.AIRMCP_USAGE_TRACKING = 'false';
process.env.AIRMCP_MEMORY_STORE_PATH = join(SCRATCH, 'memory.json');
process.env.AIRMCP_VECTOR_STORE_DIR = join(SCRATCH, 'vectors');
process.env.AIRMCP_USAGE_PROFILE_PATH = join(SCRATCH, 'profile.json');
process.env.AIRMCP_HITL_SOCKET_PATH = join(SCRATCH, 'hitl.sock');

// ── Platform mocks (must precede all dynamic imports) ────────────────
const mocks = setupPlatformMocks();

jest.unstable_mockModule('../dist/weather/api.js', () => ({
  fetchCurrentWeather: jest.fn(),
  fetchDailyForecast: jest.fn(),
  fetchHourlyForecast: jest.fn(),
}));

const weatherApi = await import('../dist/weather/api.js');
const { MODULE_MANIFEST } = await import('../dist/shared/modules.js');

// Decorated the way src/shared/jxa.ts describeJxaError() emits it in prod.
const PERM_MESSAGE =
  'Not authorized to send Apple events. (-1743) Permission denied — grant ' +
  'Automation access in System Settings > Privacy & Security > Automation.';
const GUIDANCE_MARKER = 'System Settings';
const nativeFetch = globalThis.fetch;
// Coverage instrumentation makes the Google Workspace CLI failure paths take
// longer than 10 seconds on CI. Keep a finite per-tool bound while leaving
// enough headroom for the instrumented all-tool contract run.
const CONTRACT_TIMEOUT_MS = 30_000;

/**
 * Tools excluded from the contract, each with a reason a reviewer can veto.
 * Keep this list SHORT — every entry is a hole in the runtime floor.
 */
const EXEMPT = new Map([
  // populated only when a tool genuinely cannot run under this harness;
  // the ratchet test prints the reason next to the name.
]);

/** Args for tools whose schema is too open-ended to synthesize generically. */
const ARG_OVERRIDES = new Map([
  // tool name -> args object
]);

// ── Generic argument synthesis from a Zod schema ─────────────────────
const CANDIDATES = [
  'test',
  '123',
  '/tmp/airmcp-contract/test.txt',
  '/tmp/airmcp-contract',
  '2026-01-01T00:00:00Z',
  '2026-01-01',
  'https://example.com',
  'test@example.com',
  '123e4567-e89b-42d3-a456-426614174000',
  1,
  0,
  true,
  false,
  [],
  {},
];

function schemaDef(schema) {
  return schema?._zod?.def ?? schema?._def ?? {};
}

function synthesizeValue(schema, depth = 0) {
  if (depth > 4 || !schema || typeof schema.safeParse !== 'function') return undefined;
  for (const candidate of CANDIDATES) {
    if (schema.safeParse(candidate).success) return candidate;
  }
  const def = schemaDef(schema);
  const type = def.type ?? def.typeName;
  if (type === 'enum' || type === 'ZodEnum') {
    const values = def.entries ? Object.values(def.entries) : def.values;
    return Array.isArray(values) ? values[0] : values ? Object.values(values)[0] : undefined;
  }
  if (type === 'literal' || type === 'ZodLiteral') {
    return Array.isArray(def.values) ? def.values[0] : def.value;
  }
  if (type === 'union' || type === 'ZodUnion') {
    for (const option of def.options ?? []) {
      const v = synthesizeValue(option, depth + 1);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  if (type === 'array' || type === 'ZodArray') {
    const el = synthesizeValue(def.element ?? def.type, depth + 1);
    if (el === undefined) return [];
    // Satisfy minimum-length constraints (e.g. compare_notes needs >= 2 ids).
    for (const arr of [[el], [el, el], [el, el, el]]) {
      if (schema.safeParse(arr).success) return arr;
    }
    return [el];
  }
  if (type === 'object' || type === 'ZodObject') {
    return synthesizeArgs(def.shape ?? {}, depth + 1);
  }
  const inner = def.innerType ?? def.in;
  if (inner) return synthesizeValue(inner, depth + 1);
  return undefined;
}

function synthesizeArgs(shape, depth = 0) {
  const args = {};
  for (const [key, schema] of Object.entries(shape ?? {})) {
    if (typeof schema?.safeParse !== 'function') continue;
    // Optional / defaulted keys are omitted; z.object().parse applies defaults.
    if (schema.safeParse(undefined).success) continue;
    const value = synthesizeValue(schema, depth);
    if (value !== undefined) args[key] = value;
  }
  return args;
}

function buildArgs(name, inputSchema) {
  if (ARG_OVERRIDES.has(name)) return { ok: true, args: ARG_OVERRIDES.get(name) };
  const schema =
    inputSchema && typeof inputSchema.safeParse === 'function'
      ? inputSchema
      : z.object(inputSchema ?? {});
  const parsed = schema.safeParse(synthesizeArgs(inputSchema?.shape ?? inputSchema ?? {}));
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, args: parsed.data };
}

// ── Registration (mirrors src/shared/module-loader findRegisterFn) ───
function findRegisterFn(mod) {
  let fallback;
  for (const [key, val] of Object.entries(mod)) {
    if (typeof val === 'function' && key.startsWith('register')) {
      if (key.includes('Dynamic')) {
        fallback = fallback ?? val;
        continue;
      }
      return val;
    }
  }
  return fallback;
}

const server = createMockServer();
const failedModules = [];

beforeAll(async () => {
  const config = createMockConfig();
  for (const def of MODULE_MANIFEST) {
    try {
      const mod = await import(`../dist/${def.name}/tools.js`);
      const register = findRegisterFn(mod);
      if (!register) {
        failedModules.push(`${def.name}: no register* export`);
        continue;
      }
      await register(server, config);
    } catch (e) {
      failedModules.push(`${def.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}, 60_000);

// ── The contract run ─────────────────────────────────────────────────
const EXECUTOR_MOCKS = () => [
  mocks.mockRunJxa,
  mocks.mockRunAppleScript,
  mocks.mockRunSwift,
  mocks.mockRunAutomation,
  weatherApi.fetchCurrentWeather,
  weatherApi.fetchDailyForecast,
  weatherApi.fetchHourlyForecast,
];

function armExecutorFailure() {
  const err = () => new Error(PERM_MESSAGE);
  for (const fn of EXECUTOR_MOCKS()) fn.mockReset().mockRejectedValue(err());
  mocks.mockCheckSwiftBridge.mockReset().mockResolvedValue('Swift bridge not available');
  mocks.mockHasSwiftCommand.mockReset().mockResolvedValue(false);
}

/** Apple-side executors: their permission failures are TCC denials, so the
 *  contract demands the permission_denied category. Network executors (fetch,
 *  weather API) keep their own upstream taxonomy. */
function appleExecutorTouched() {
  return [mocks.mockRunJxa, mocks.mockRunAppleScript, mocks.mockRunSwift, mocks.mockRunAutomation].some(
    (fn) => fn.mock.calls.length > 0,
  );
}

function executorTouched() {
  return EXECUTOR_MOCKS().some((fn) => fn.mock.calls.length > 0);
}

async function runContract(name, entry) {
  const built = buildArgs(name, entry.opts?.inputSchema);
  if (!built.ok) return { name, violations: [`args unsynthesizable: ${built.error?.slice(0, 200)}`] };

  armExecutorFailure();
  const fetchSpy = jest.fn().mockRejectedValue(new Error(PERM_MESSAGE));
  globalThis.fetch = fetchSpy;
  let res;
  let timer;
  try {
    res = await Promise.race([
      server.callTool(name, built.args),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`contract timeout (${CONTRACT_TIMEOUT_MS / 1000}s)`)),
          CONTRACT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (e) {
    return { name, violations: [`A. handler threw: ${e instanceof Error ? e.message.slice(0, 300) : e}`] };
  } finally {
    clearTimeout(timer);
    globalThis.fetch = nativeFetch;
  }
  const touched = executorTouched() || fetchSpy.mock.calls.length > 0;
  const appleTouched = appleExecutorTouched();

  const violations = [];
  if (!res || !Array.isArray(res.content) || res.content.some((c) => typeof c.type !== 'string')) {
    violations.push('A. response is not MCP-shaped ({ content: [{ type, ... }] })');
    return { name, violations };
  }
  const text = res.content
    .filter((c) => typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');

  if (touched) {
    if (!res.isError) {
      violations.push('B. executor rejected with permission error but tool reported success (silent-empty, #145 class)');
    } else {
      if (!text.includes(GUIDANCE_MARKER)) {
        violations.push('C. recovery guidance lost — error text lacks the System Settings instruction');
      }
      const category = res.structuredContent?.error?.category;
      if (appleTouched && category !== undefined && category !== 'permission_denied') {
        violations.push(`D. misclassified: expected permission_denied, got ${category}`);
      }
    }
  }
  if (text.includes('\n    at ')) {
    violations.push('C. raw stack trace leaked to the tool response');
  }
  return { name, violations };
}

describe('runtime error contract (all modules)', () => {
  afterAll(async () => {
    // The webhooks start tool binds a real loopback server; release the handle.
    const { _resetWebhookListenerForTests } = await import('../dist/webhooks/listener.js');
    _resetWebhookListenerForTests();
  });

  test('all manifest modules register under the harness', () => {
    expect(failedModules).toEqual([]);
  });

  test(
    'every tool survives executor permission failure per contract',
    async () => {
      const results = [];
      for (const [name, entry] of server._tools) {
        if (EXEMPT.has(name)) continue;
        results.push(await runContract(name, entry));
      }
      const failures = results
        .filter((r) => r.violations.length > 0)
        .map((r) => `${r.name}:\n  ${r.violations.join('\n  ')}`);
      expect(failures).toEqual([]);
      // Ratchet: the harness must keep covering the catalog as it grows.
      expect(results.length).toBeGreaterThanOrEqual(200);
    },
    300_000,
  );

  test('exempt list only names registered tools (no zombie exemptions)', () => {
    for (const name of EXEMPT.keys()) {
      expect(server._tools.has(name)).toBe(true);
    }
  });
});
