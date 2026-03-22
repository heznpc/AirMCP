import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerNumbersTools } = await import('../dist/numbers/tools.js');

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

describe('Numbers tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerNumbersTools(server, {});
  });

  test('registers all 9 numbers tools', () => {
    expect(server.tools.size).toBe(9);
    const expected = [
      'numbers_list_documents',
      'numbers_create_document',
      'numbers_list_sheets',
      'numbers_get_cell',
      'numbers_set_cell',
      'numbers_read_cells',
      'numbers_add_sheet',
      'numbers_export_pdf',
      'numbers_close_document',
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
