import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

jest.unstable_mockModule('../dist/maps/api.js', () => ({
  fetchGeocode: jest.fn(),
  fetchReverseGeocode: jest.fn(),
}));

const { registerMapsTools } = await import('../dist/maps/tools.js');

function createMockServer() {
  const tools = new Map();
  return {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    tools,
    async callTool(name, args = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      return tool.handler(args);
    },
  };
}

describe('Maps tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerMapsTools(server, {});
  });

  test('registers all 8 maps tools', () => {
    expect(server.tools.size).toBe(8);
    const expected = [
      'search_location',
      'get_directions',
      'drop_pin',
      'open_address',
      'search_nearby',
      'share_location',
      'geocode',
      'reverse_geocode',
    ];
    for (const name of expected) {
      expect(server.tools.has(name)).toBe(true);
    }
  });

  test('all tools have titles and descriptions', () => {
    for (const [, { config }] of server.tools) {
      expect(typeof config.title).toBe('string');
      expect(config.title.length).toBeGreaterThan(0);
      expect(typeof config.description).toBe('string');
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  test('all tools have annotations', () => {
    for (const [, { config }] of server.tools) {
      expect(config.annotations).toBeDefined();
      expect(typeof config.annotations.readOnlyHint).toBe('boolean');
      expect(typeof config.annotations.destructiveHint).toBe('boolean');
    }
  });
});
