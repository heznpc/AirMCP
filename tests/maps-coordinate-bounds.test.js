/**
 * Regression test for MEDIUM #14 in the 2026-05-13 audit:
 *
 *   "src/maps/scripts.ts:28-34 interpolates latitude/longitude as raw
 *    numbers. Zod schema z.number() for drop_pin and share_location
 *    does NOT bound to [-90, 90]/[-180, 180] (compare reverse_geocode
 *    at line 174). Zod accepts ±Infinity. Resulting JXA receives the
 *    literal `Infinity` keyword — parses cleanly but yields garbage."
 *
 * Fix: bound every coordinate-shaped input the way `reverse_geocode`
 * was already bounded. This test exercises the Zod schemas directly so
 * the test runs without a Mac.
 *
 * The schemas are reconstructed from the tools.ts source rather than
 * imported — `registerMapsTools` registers them onto an `McpServer`
 * which only stores the inputSchema as a record-of-Zod (the same
 * shape passed in). We use the registered shape from a fake server
 * to validate via the tool registry path that production uses.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';
import { z } from 'zod';

// Mock the JXA bridge so registration completes without a Mac.
jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: jest.fn(async () => ({})),
}));
jest.unstable_mockModule('../dist/maps/api.js', () => ({
  fetchGeocode: jest.fn(async () => []),
  fetchReverseGeocode: jest.fn(async () => ({})),
}));

const { registerMapsTools } = await import('../dist/maps/tools.js');

let dropPinSchema;
let shareLocationSchema;
let searchNearbySchema;
let reverseGeocodeSchema;

beforeAll(() => {
  // Capture the inputSchemas as the SDK's `registerTool` would see them.
  // Each tool's `inputSchema` is a record of Zod-typed columns; wrap in
  // z.object so we can call `.parse()` to exercise the full validation
  // path including the .min/.max boundary checks.
  const fakeServer = {
    registerTool: jest.fn((name, def) => {
      if (name === 'drop_pin') dropPinSchema = z.object(def.inputSchema);
      else if (name === 'share_location') shareLocationSchema = z.object(def.inputSchema);
      else if (name === 'search_nearby') searchNearbySchema = z.object(def.inputSchema);
      else if (name === 'reverse_geocode') reverseGeocodeSchema = z.object(def.inputSchema);
    }),
  };
  registerMapsTools(fakeServer, {});
});

describe('maps coordinate bounds', () => {
  describe('drop_pin', () => {
    test('accepts genuine coordinates', () => {
      expect(() => dropPinSchema.parse({ latitude: 37.5665, longitude: 126.978 })).not.toThrow();
      expect(() => dropPinSchema.parse({ latitude: -90, longitude: -180 })).not.toThrow();
      expect(() => dropPinSchema.parse({ latitude: 90, longitude: 180 })).not.toThrow();
    });

    test('rejects out-of-range latitude', () => {
      expect(() => dropPinSchema.parse({ latitude: 91, longitude: 0 })).toThrow();
      expect(() => dropPinSchema.parse({ latitude: -90.001, longitude: 0 })).toThrow();
    });

    test('rejects out-of-range longitude', () => {
      expect(() => dropPinSchema.parse({ latitude: 0, longitude: 181 })).toThrow();
      expect(() => dropPinSchema.parse({ latitude: 0, longitude: -180.001 })).toThrow();
    });

    test('rejects ±Infinity (this is the bug fix)', () => {
      expect(() => dropPinSchema.parse({ latitude: Infinity, longitude: 0 })).toThrow();
      expect(() => dropPinSchema.parse({ latitude: 0, longitude: -Infinity })).toThrow();
    });
  });

  describe('share_location', () => {
    test('accepts genuine coordinates', () => {
      expect(() => shareLocationSchema.parse({ latitude: 35.6762, longitude: 139.6503 })).not.toThrow();
    });

    test('rejects out-of-range and Infinity', () => {
      expect(() => shareLocationSchema.parse({ latitude: 100, longitude: 0 })).toThrow();
      expect(() => shareLocationSchema.parse({ latitude: 0, longitude: Infinity })).toThrow();
    });
  });

  describe('search_nearby (optional coords, still bounded when provided)', () => {
    test('accepts query without coords (uses current location)', () => {
      expect(() => searchNearbySchema.parse({ query: 'coffee' })).not.toThrow();
    });

    test('accepts query with valid coords', () => {
      expect(() => searchNearbySchema.parse({ query: 'coffee', latitude: 0, longitude: 0 })).not.toThrow();
    });

    test('rejects query with out-of-range or Infinity coords', () => {
      expect(() => searchNearbySchema.parse({ query: 'coffee', latitude: 91, longitude: 0 })).toThrow();
      expect(() => searchNearbySchema.parse({ query: 'coffee', latitude: 0, longitude: Infinity })).toThrow();
    });
  });

  describe('reverse_geocode (already bounded — regression pin)', () => {
    // Pin existing behaviour so a future refactor doesn't accidentally
    // remove what was the lone schema doing the right thing pre-audit.
    test('rejects out-of-range coordinates', () => {
      expect(() => reverseGeocodeSchema.parse({ latitude: 91, longitude: 0 })).toThrow();
      expect(() => reverseGeocodeSchema.parse({ latitude: 0, longitude: Infinity })).toThrow();
    });
  });
});
