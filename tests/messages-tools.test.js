import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();
const mockRunAppleScript = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
  runAppleScript: mockRunAppleScript,
}));

const { registerMessagesTools } = await import('../dist/messages/tools.js');

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

describe('Messages tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerMessagesTools(server, {});
  });

  test('registers all 6 messages tools', () => {
    expect(server.tools.size).toBe(6);
    const expected = [
      'list_chats',
      'read_chat',
      'search_chats',
      'send_message',
      'send_file',
      'list_participants',
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
