import { describe, test, expect, jest } from '@jest/globals';

const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn();

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
}));

// Mock the SemanticSearchService
jest.unstable_mockModule('../dist/semantic/service.js', () => ({
  SemanticSearchService: class {
    constructor() {}
    index() {}
    search() {}
    findRelated() {}
    status() {}
    clear() {}
  },
}));

const { registerSemanticTools } = await import('../dist/semantic/tools.js');

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

describe('Semantic tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerSemanticTools(server, {});
  });

  test('registers all 7 semantic tools', () => {
    expect(server.tools.size).toBe(7);
    const expected = [
      'semantic_index',
      'semantic_search',
      'find_related',
      'spotlight_sync',
      'semantic_clear',
      'spotlight_clear',
      'semantic_status',
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
