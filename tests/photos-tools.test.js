import { describe, test, expect, jest } from '@jest/globals';

// Mock the automation and swift bridges — photos tools require macOS
const mockRunAutomation = jest.fn();
const mockRunSwift = jest.fn();

jest.unstable_mockModule('../dist/shared/automation.js', () => ({
  runAutomation: mockRunAutomation,
}));

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: jest.fn(),
}));

const { registerPhotosTools } = await import('../dist/photos/tools.js');

// Minimal mock MCP server
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

describe('Photos tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerPhotosTools(server, {});
  });

  test('registers all 11 photos tools', () => {
    expect(server.tools.size).toBe(11);
    const expectedTools = [
      'list_albums',
      'list_photos',
      'search_photos',
      'get_photo_info',
      'list_favorites',
      'create_album',
      'add_to_album',
      'import_photo',
      'delete_photos',
      'query_photos',
      'classify_image',
    ];
    for (const name of expectedTools) {
      expect(server.tools.has(name)).toBe(true);
    }
  });

  test('all tools have titles and descriptions', () => {
    for (const [name, { config }] of server.tools) {
      expect(config.title).toBeDefined();
      expect(typeof config.title).toBe('string');
      expect(config.title.length).toBeGreaterThan(0);
      expect(config.description).toBeDefined();
      expect(typeof config.description).toBe('string');
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  test('all tools have annotations', () => {
    for (const [name, { config }] of server.tools) {
      expect(config.annotations).toBeDefined();
      expect(typeof config.annotations.readOnlyHint).toBe('boolean');
      expect(typeof config.annotations.destructiveHint).toBe('boolean');
    }
  });

  test('read-only query tools have correct annotations', () => {
    const readOnlyTools = [
      'list_albums',
      'list_photos',
      'search_photos',
      'get_photo_info',
      'list_favorites',
      'query_photos',
      'classify_image',
    ];
    for (const name of readOnlyTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('mutating tools are not read-only', () => {
    const mutatingTools = ['create_album', 'add_to_album', 'import_photo', 'delete_photos'];
    for (const name of mutatingTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(false);
    }
  });

  test('delete_photos is marked destructive', () => {
    const { config } = server.tools.get('delete_photos');
    expect(config.annotations.destructiveHint).toBe(true);
  });

  test('create_album is not marked destructive', () => {
    const { config } = server.tools.get('create_album');
    expect(config.annotations.destructiveHint).toBe(false);
  });
});
