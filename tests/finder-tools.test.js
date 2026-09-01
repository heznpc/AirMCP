import { describe, test, expect, jest } from '@jest/globals';
import vm from 'node:vm';
import { createMockServer } from './helpers/mock-server.js';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerFinderTools } = await import('../dist/finder/tools.js');
const { HOME } = await import('../dist/shared/constants.js');

function executeFinderScript(script) {
  const commands = [];
  function Application() {}
  Application.currentApplication = () => ({
    doShellScript(command) {
      commands.push(command);
      return '';
    },
  });
  vm.runInNewContext(script, { Application });
  return commands;
}

describe('Finder tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerFinderTools(server, {});
  });

  test('registers all 8 finder tools', () => {
    expect(server._tools.size).toBe(8);
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
      expect(server._tools.has(name)).toBe(true);
    }
  });

  test('all tools have titles and descriptions', () => {
    for (const [, { opts }] of server._tools) {
      expect(typeof opts.title).toBe('string');
      expect(opts.title.length).toBeGreaterThan(0);
      expect(typeof opts.description).toBe('string');
      expect(opts.description.length).toBeGreaterThan(0);
    }
  });

  test('all tools have annotations', () => {
    for (const [, { opts }] of server._tools) {
      expect(opts.annotations).toBeDefined();
      expect(typeof opts.annotations.readOnlyHint).toBe('boolean');
      expect(typeof opts.annotations.destructiveHint).toBe('boolean');
    }
  });

  test('read-only tools have correct annotations', () => {
    const readOnly = ['search_files', 'get_file_info', 'recent_files', 'list_directory'];
    for (const name of readOnly) {
      const { opts } = server._tools.get(name);
      expect(opts.annotations.readOnlyHint).toBe(true);
      expect(opts.annotations.destructiveHint).toBe(false);
    }
  });

  test('move_file and trash_file are destructive', () => {
    for (const name of ['move_file', 'trash_file']) {
      const { opts } = server._tools.get(name);
      expect(opts.annotations.destructiveHint).toBe(true);
    }
  });

  test('create_directory is not destructive but requires sensitive approval', () => {
    const { opts } = server._tools.get('create_directory');
    expect(opts.annotations.destructiveHint).toBe(false);
    expect(opts.annotations.sensitiveHint).toBe(true);
  });

  test.each(['search_files', 'recent_files'])('%s resolves an omitted folder through zFilePath', async (name) => {
    mockRunJxa.mockResolvedValueOnce({ total: 0, files: [] });
    await server.callTool(name, name === 'search_files' ? { query: 'report' } : {});

    const [script] = mockRunJxa.mock.calls.at(-1);
    const [command] = executeFinderScript(script);
    expect(command).toContain(`mdfind -onlyin "${HOME}"`);
    expect(command).not.toContain('mdfind -onlyin "~"');
  });
});
