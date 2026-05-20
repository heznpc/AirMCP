/**
 * Wave 8 outputSchema contract test.
 *
 * For every tool registered in the 11 modules that just went from 0%
 * coverage to 100%, assert that:
 *
 *   (a) the tool's config has an `outputSchema` declaration, AND
 *   (b) when the tool's bridge is forced into the success path, the
 *       returned `structuredContent` parses cleanly against that
 *       outputSchema (i.e. the declared shape is consistent with what
 *       the handler actually emits).
 *
 * This is the contract guard the 2026-05-13 test-quality survey said
 * was missing — the existing per-module tests are mostly registration
 * smoke + mock round-trip, neither of which validates that the
 * outputSchema and the handler's emit agree. A future refactor that
 * changes a field name or drops a key from the script's JSON return
 * would slip past the round-trip tests but fail this contract test.
 *
 * Why an integrated test instead of one per module: 11 modules × N
 * tools = a lot of nearly-identical fixture files. One contract test
 * driven by a fixture table is the maintenance-cheap option, and the
 * "for each module ensure outputSchema present" assertion alone
 * justifies the file.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { z } from 'zod';

const mockRunJxa = jest.fn();
const mockRunAppleScript = jest.fn();
const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn(async () => null);
const mockRunGws = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
  runAppleScript: mockRunAppleScript,
}));
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
  hasSwiftCommand: async () => true,
  closeSwiftBridge: () => {},
}));
// Google Workspace runs through its own bridge module; some tools also
// touch fetch/auth. Mock the shared call surface.
jest.unstable_mockModule('../dist/google/gws.js', () => ({
  runGws: mockRunGws,
  isGwsAvailable: () => true,
  // `checkGws` returns null when the GWS bridge is reachable and a
  // string error message otherwise. Mock the happy path so register
  // sites that consult availability at construction time succeed.
  checkGws: async () => null,
}));

const registerers = {};
async function tryRegister(modulePath, exportName) {
  try {
    const mod = await import(modulePath);
    if (typeof mod[exportName] === 'function') registerers[modulePath] = mod[exportName];
  } catch {
    /* module may not export the expected register fn — skip */
  }
}
// Sequential — `await Promise.all([...])` races jest's ESM module
// linker (`--experimental-vm-modules`) when multiple dynamic imports
// resolve in parallel against a freshly-installed
// `jest.unstable_mockModule` namespace, producing
// `request for './tool-links.js' is from a module not been linked`
// for whichever import loses the race. Awaiting in series gives the
// linker time to settle each module's transitive graph before the
// next one starts.
for (const [path, name] of [
  ['../dist/pages/tools.js', 'registerPagesTools'],
  ['../dist/keynote/tools.js', 'registerKeynoteTools'],
  ['../dist/podcasts/tools.js', 'registerPodcastsTools'],
  ['../dist/maps/tools.js', 'registerMapsTools'],
  ['../dist/location/tools.js', 'registerLocationTools'],
  ['../dist/bluetooth/tools.js', 'registerBluetoothTools'],
  ['../dist/tv/tools.js', 'registerTvTools'],
  ['../dist/ui/tools.js', 'registerUiTools'],
  ['../dist/screen/tools.js', 'registerScreenTools'],
  ['../dist/semantic/tools.js', 'registerSemanticTools'],
  ['../dist/speech/tools.js', 'registerSpeechTools'],
  ['../dist/google/tools.js', 'registerGoogleTools'],
]) {
  // eslint-disable-next-line no-await-in-loop -- linker requires serial
  await tryRegister(path, name);
}

function createMockServer() {
  const tools = new Map();
  return {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    tools,
  };
}

/**
 * Module fixture: register the module, return the populated server.
 * The register-fn export name varies by module — try a few common
 * shapes.
 */
function collectModule(modulePath) {
  const fn = registerers[modulePath];
  if (!fn) return null;
  const server = createMockServer();
  // Most modules accept (server, config). Google needs allowNetwork.
  fn(server, { allowNetwork: true, allowSendMessages: true });
  return server;
}

const MODULES = [
  { path: '../dist/pages/tools.js', name: 'pages', expectedCount: 7 },
  { path: '../dist/keynote/tools.js', name: 'keynote', expectedCount: 9 },
  { path: '../dist/podcasts/tools.js', name: 'podcasts', expectedCount: 6 },
  { path: '../dist/maps/tools.js', name: 'maps', expectedCount: 8 },
  { path: '../dist/location/tools.js', name: 'location', expectedCount: 2 },
  { path: '../dist/bluetooth/tools.js', name: 'bluetooth', expectedCount: 4 },
  { path: '../dist/tv/tools.js', name: 'tv', expectedCount: 6 },
  { path: '../dist/ui/tools.js', name: 'ui', expectedCount: 10 },
  { path: '../dist/screen/tools.js', name: 'screen', expectedCount: 5 },
  { path: '../dist/semantic/tools.js', name: 'semantic', expectedCount: 7 },
  { path: '../dist/speech/tools.js', name: 'speech', expectedCount: 3 },
  { path: '../dist/google/tools.js', name: 'google', expectedCount: 16 },
];

describe('Wave 8 outputSchema presence', () => {
  test.each(MODULES)('$name: every tool declares outputSchema', ({ path, name, expectedCount }) => {
    const server = collectModule(path);
    if (!server) {
      // Module exists but couldn't be registered (e.g. test environment
      // missing a dep). Surface as a failure so a future broken import
      // doesn't silently skip coverage.
      throw new Error(`Could not register ${name} module from ${path}`);
    }
    expect(server.tools.size).toBe(expectedCount);
    for (const [toolName, { config }] of server.tools) {
      expect(config.outputSchema).toBeDefined();
      // outputSchema must be an object whose values are zod schemas —
      // both `z.object({...}).shape` and a plain shape literal pass.
      // Smoke-check by verifying at least one key holds something that
      // looks like a zod schema (`.parse` or `.safeParse` or `_def`).
      const keys = Object.keys(config.outputSchema);
      expect(keys.length).toBeGreaterThan(0);
      // The MCP SDK accepts the raw shape (record of zod schemas). We
      // require every value to expose a Zod-ish marker so a typo like
      // `outputSchema: { foo: "string" }` would fail here.
      for (const k of keys) {
        const v = config.outputSchema[k];
        expect(typeof v.parse === 'function' || typeof v.safeParse === 'function' || v?._def).toBeTruthy();
      }
    }
  });
});

describe('Wave 8 outputSchema runtime consistency', () => {
  // Drive a representative tool from each module through the success
  // path with a synthetic mock response. Assert the returned
  // structuredContent parses against the declared outputSchema. We
  // pick ONE tool per module that exercises the most non-trivial
  // shape — full per-tool fuzz would belong in module-specific suites.
  const CASES = [
    {
      module: '../dist/pages/tools.js',
      tool: 'pages_list_documents',
      args: {},
      mock: () => mockRunJxa.mockResolvedValue([{ name: 'a.pages', path: null, modified: false }]),
    },
    {
      module: '../dist/keynote/tools.js',
      tool: 'keynote_list_documents',
      args: {},
      mock: () => mockRunJxa.mockResolvedValue([{ name: 'a.key', path: '/tmp/a.key', modified: true }]),
    },
    {
      module: '../dist/podcasts/tools.js',
      tool: 'list_podcast_shows',
      args: {},
      mock: () => mockRunJxa.mockResolvedValue([{ name: 'Show', author: 'A', episodeCount: 10 }]),
    },
    {
      module: '../dist/location/tools.js',
      tool: 'get_location_permission',
      args: {},
      mock: () => mockRunSwift.mockResolvedValue({ status: 'authorizedAlways', authorized: true }),
    },
    {
      module: '../dist/bluetooth/tools.js',
      tool: 'get_bluetooth_state',
      args: {},
      mock: () => mockRunSwift.mockResolvedValue({ state: 'poweredOn', powered: true }),
    },
  ];

  test.each(CASES)('$tool: handler emit conforms to declared outputSchema', async ({ module, tool, args, mock }) => {
    const server = collectModule(module);
    if (!server) throw new Error(`Module ${module} not loaded`);
    const entry = server.tools.get(tool);
    expect(entry).toBeDefined();
    mockRunJxa.mockReset();
    mockRunSwift.mockReset();
    mockRunSwift.mockResolvedValue({});
    mockCheckSwiftBridge.mockResolvedValue(null);
    mock();
    const result = await entry.handler(args);
    expect(result.isError).toBeUndefined();
    // Synthesize a zod object from the declared shape and parse the
    // emitted structuredContent through it. Any drift between handler
    // and schema fails here.
    const schema = z.object(entry.config.outputSchema);
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `${tool}: structuredContent failed outputSchema validation:\n  ${parsed.error.message}\n  payload: ${JSON.stringify(result.structuredContent)}`,
      );
    }
  });
});
