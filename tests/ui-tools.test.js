import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

// Mock ax-query module
jest.unstable_mockModule('../dist/ui/ax-query.js', () => ({
  axQueryScript: jest.fn(),
  axPerformScript: jest.fn(),
  axTraverseScript: jest.fn(),
  axDiffScript: jest.fn(),
}));

const { registerUiTools } = await import('../dist/ui/tools.js');

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

describe('UI tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerUiTools(server, {});
  });

  test('registers all 10 UI tools', () => {
    expect(server.tools.size).toBe(10);
    const expected = [
      'ui_open_app',
      'ui_click',
      'ui_type',
      'ui_press_key',
      'ui_scroll',
      'ui_read',
      'ui_accessibility_query',
      'ui_perform_action',
      'ui_traverse',
      'ui_diff',
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

  test('ui_read is read-only', () => {
    const { config } = server.tools.get('ui_read');
    expect(config.annotations.readOnlyHint).toBe(true);
  });

  test('ui_click and ui_type are not read-only', () => {
    for (const name of ['ui_click', 'ui_type']) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(false);
    }
  });
});
