/**
 * Regression test for coordinate bounds across the maps + weather modules.
 *
 * Audit (2026-05-13) flagged a consistency gap in `src/maps/tools.ts`:
 * `drop_pin` and `search_nearby` originally accepted bare `z.number()`
 * for lat/lng while `reverse_geocode` was already bounded
 * `.min(-90).max(90)` / `.min(-180).max(180)`. The fix tightened every
 * coordinate-shaped input to the same bounds. This test pins those
 * bounds down so a future refactor removing the `.min/.max` calls fails
 * loudly — a bare `z.number()` would accept Infinity, NaN, and
 * out-of-range degrees, all of which produce silent garbage when JXA
 * passes the literal value to Apple Maps / Weather.
 *
 * Why this matters: lat=200 doesn't error, it just drops a pin at a
 * nonsense point. Infinity is worse — it crashes the JXA script with no
 * recovery path because the user already approved a destructive call.
 *
 * Tests both valid and invalid coordinates against every registered
 * map/weather tool that takes lat/lng.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { z } from 'zod';

// Mock the bridges so registering doesn't try to launch a real Swift
// binary or shell out to osascript. We don't actually call the bridges
// in this test — schema validation should fail BEFORE the handler runs.
const mockRunJxa = jest.fn();
const mockRunSwift = jest.fn();
const mockRunAppleScript = jest.fn();
const mockCheckSwiftBridge = jest.fn(async () => null);

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

const { registerMapsTools } = await import('../dist/maps/tools.js');
const { registerWeatherTools } = await import('../dist/weather/tools.js');

function createMockServer() {
  const tools = new Map();
  return {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    tools,
    /**
     * Drives the schema → handler flow the same way the MCP SDK does:
     * zod parses first; on failure the SDK never reaches the handler and
     * returns an error envelope. Re-implementing that locally lets the
     * test assert the bounds without spinning a real SDK.
     */
    async callTool(name, args = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      if (tool.config.inputSchema) {
        const schema = z.object(tool.config.inputSchema);
        const parsed = schema.safeParse(args);
        if (!parsed.success) {
          return {
            isError: true,
            content: [{ type: 'text', text: parsed.error.message }],
          };
        }
        return tool.handler(parsed.data);
      }
      return tool.handler(args);
    },
  };
}

// Per-tool fixture map. Lists every (module, tool, latArg, lngArg) tuple
// so we can blast both modules with the same set of invalid coordinates.
const COORD_TOOLS = [
  { module: 'maps', tool: 'drop_pin', extra: {} },
  { module: 'maps', tool: 'search_nearby', extra: { query: 'coffee' } },
  { module: 'maps', tool: 'share_location', extra: {} },
  { module: 'maps', tool: 'reverse_geocode', extra: {} },
  { module: 'weather', tool: 'get_current_weather', extra: {} },
  { module: 'weather', tool: 'get_hourly_forecast', extra: {} },
  { module: 'weather', tool: 'get_daily_forecast', extra: {} },
];

const INVALID_LATS = [
  { value: 90.001, label: 'lat just above 90' },
  { value: -90.001, label: 'lat just below -90' },
  { value: 200, label: 'lat way out of range' },
  { value: Number.POSITIVE_INFINITY, label: 'lat +Infinity' },
  { value: Number.NEGATIVE_INFINITY, label: 'lat -Infinity' },
  { value: Number.NaN, label: 'lat NaN' },
];
const INVALID_LNGS = [
  { value: 180.001, label: 'lng just above 180' },
  { value: -180.001, label: 'lng just below -180' },
  { value: 400, label: 'lng way out of range' },
  { value: Number.POSITIVE_INFINITY, label: 'lng +Infinity' },
];

describe('maps/weather coordinate bounds', () => {
  let mapsServer;
  let weatherServer;
  beforeAll(() => {
    mapsServer = createMockServer();
    weatherServer = createMockServer();
    registerMapsTools(mapsServer, {});
    registerWeatherTools(weatherServer, {});
  });

  test.each(COORD_TOOLS)('$tool exists in $module module', ({ module, tool }) => {
    const server = module === 'maps' ? mapsServer : weatherServer;
    expect(server.tools.has(tool)).toBe(true);
  });

  test.each(
    COORD_TOOLS.flatMap((t) =>
      INVALID_LATS.map((bad) => ({ ...t, badLat: bad.value, badLatLabel: bad.label })),
    ),
  )('$tool rejects $badLatLabel', async ({ module, tool, extra, badLat }) => {
    mockRunJxa.mockReset();
    mockRunSwift.mockReset();
    const server = module === 'maps' ? mapsServer : weatherServer;
    const result = await server.callTool(tool, {
      ...extra,
      latitude: badLat,
      longitude: 0,
    });
    // The handler MUST NOT have been called — the Zod bounds short-circuit
    // first. If a future refactor accidentally drops `.min/.max`, the
    // bridge would be invoked with garbage coordinates and this assertion
    // would fail loudly.
    expect(mockRunJxa).not.toHaveBeenCalled();
    expect(mockRunSwift).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  test.each(
    COORD_TOOLS.flatMap((t) =>
      INVALID_LNGS.map((bad) => ({ ...t, badLng: bad.value, badLngLabel: bad.label })),
    ),
  )('$tool rejects $badLngLabel', async ({ module, tool, extra, badLng }) => {
    mockRunJxa.mockReset();
    mockRunSwift.mockReset();
    const server = module === 'maps' ? mapsServer : weatherServer;
    const result = await server.callTool(tool, {
      ...extra,
      latitude: 0,
      longitude: badLng,
    });
    expect(mockRunJxa).not.toHaveBeenCalled();
    expect(mockRunSwift).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  test('valid coordinates still pass through to the bridge', async () => {
    mockRunJxa.mockReset();
    mockRunSwift.mockReset();
    mockRunJxa.mockResolvedValue({ ok: true });
    mockRunSwift.mockResolvedValue({ ok: true });
    // Just one representative valid call — extensive happy-path coverage
    // lives in the per-tool tests. We only want to confirm here that the
    // bounds don't over-reject legitimate inputs.
    const result = await mapsServer.callTool('drop_pin', {
      latitude: 37.7749,
      longitude: -122.4194,
      label: 'San Francisco',
    });
    expect(result.isError).toBeFalsy();
    expect(mockRunJxa).toHaveBeenCalledTimes(1);
  });
});
