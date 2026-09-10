import { describe, test, expect, jest } from '@jest/globals';
import { z } from 'zod';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerFinderTools } = await import('../dist/finder/tools.js');
const { HOME } = await import('../dist/shared/constants.js');

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

describe('Finder tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerFinderTools(server, {});
  });

  test('registers all 8 finder tools', () => {
    expect(server.tools.size).toBe(8);
    const expected = [
      'search_files',
      'get_file_info',
      'set_file_tags',
      'recent_files',
      'list_directory',
      'move_file',
      'trash_file',
      'create_directory',
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
    const readOnly = ['search_files', 'get_file_info', 'recent_files', 'list_directory'];
    for (const name of readOnly) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('move_file and trash_file are destructive', () => {
    for (const name of ['move_file', 'trash_file']) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });

  test('create_directory is not destructive but requires sensitive approval', () => {
    const { config } = server.tools.get('create_directory');
    expect(config.annotations.destructiveHint).toBe(false);
    expect(config.annotations.sensitiveHint).toBe(true);
  });

  test.each([
    ['search_files', { query: 'report' }],
    ['recent_files', {}],
  ])('%s resolves an omitted folder default through zFilePath', async (toolName, input) => {
    const { config, handler } = server.tools.get(toolName);
    const parsed = z.object(config.inputSchema).parse(input);

    expect(parsed.folder).toBe(HOME);

    mockRunJxa.mockResolvedValueOnce({ total: 0, files: [] });
    await handler(parsed);
    expect(mockRunJxa).toHaveBeenLastCalledWith(expect.stringContaining(`mdfind -onlyin "${HOME}"`));
  });
});
