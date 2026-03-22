import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerKeynoteTools } = await import('../dist/keynote/tools.js');

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

describe('Keynote tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerKeynoteTools(server, {});
  });

  test('registers all 9 keynote tools', () => {
    expect(server.tools.size).toBe(9);
    const expected = [
      'keynote_list_documents',
      'keynote_create_document',
      'keynote_list_slides',
      'keynote_get_slide',
      'keynote_add_slide',
      'keynote_set_presenter_notes',
      'keynote_export_pdf',
      'keynote_start_slideshow',
      'keynote_close_document',
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
