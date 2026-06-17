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

  test('registers all 12 numbers tools', () => {
    expect(server.tools.size).toBe(12);
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
      // RFC 0009 Phase 1 first batch
      'numbers_list_tables',
      'numbers_get_formula',
      'numbers_rename_sheet',
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

  describe('numbers_set_cell — native value typing (not text)', () => {
    beforeEach(() => mockRunJxa.mockReset());

    test('a number is written as a native numeric literal, not quoted text', async () => {
      mockRunJxa.mockResolvedValueOnce('{"written":true,"address":"A1"}');
      await server.callTool('numbers_set_cell', { document: 'D', sheet: 'S', cell: 'A1', value: 42 });
      const script = mockRunJxa.mock.calls[0][0];
      // The cell must receive the number 42, not the string "42" — a quoted
      // value lands as text and breaks sorting / formula references.
      expect(script).toContain('.value = 42;');
      expect(script).not.toContain("= '42'");
    });

    test('a boolean is written as a native boolean literal', async () => {
      mockRunJxa.mockResolvedValueOnce('{"written":true,"address":"B2"}');
      await server.callTool('numbers_set_cell', { document: 'D', sheet: 'S', cell: 'B2', value: true });
      expect(mockRunJxa.mock.calls[0][0]).toContain('.value = true;');
    });

    test('a string (incl. a formula) stays quoted + escaped', async () => {
      mockRunJxa.mockResolvedValueOnce('{"written":true,"address":"C3"}');
      await server.callTool('numbers_set_cell', {
        document: 'D',
        sheet: 'S',
        cell: 'C3',
        value: '=SUM(A1:A10)',
      });
      expect(mockRunJxa.mock.calls[0][0]).toContain(".value = '=SUM(A1:A10)';");
    });
  });
});
