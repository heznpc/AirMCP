import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerSafariTools } = await import('../dist/safari/tools.js');

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

describe('Safari tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerSafariTools(server, {});
  });

  test('registers all 12 safari tools', () => {
    expect(server.tools.size).toBe(12);
    const expected = [
      'list_tabs',
      'read_page_content',
      'get_current_tab',
      'open_url',
      'close_tab',
      'activate_tab',
      'run_javascript',
      'search_tabs',
      'list_bookmarks',
      'add_bookmark',
      'list_reading_list',
      'add_to_reading_list',
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

  test('read-only tools have correct annotations', () => {
    const readOnly = [
      'list_tabs', 'read_page_content', 'get_current_tab',
      'search_tabs', 'list_bookmarks', 'list_reading_list',
    ];
    for (const name of readOnly) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('close_tab and run_javascript are destructive', () => {
    for (const name of ['close_tab', 'run_javascript']) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });
});

describe('Safari tool gating', () => {
  test('run_javascript is blocked when allowRunJavascript is false', async () => {
    const server = createMockServer();
    registerSafariTools(server, { allowRunJavascript: false });

    const result = await server.callTool('run_javascript', {
      code: 'document.title',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disabled');
  });
});
