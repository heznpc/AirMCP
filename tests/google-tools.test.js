import { describe, test, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../dist/google/gws.js', () => ({
  runGws: jest.fn(),
  checkGws: jest.fn(),
}));

const { registerGoogleTools } = await import('../dist/google/tools.js');

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

describe('Google Workspace tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerGoogleTools(server, {});
  });

  test('registers all 16 google workspace tools', () => {
    expect(server.tools.size).toBe(16);
    const expected = [
      'gws_status',
      'gws_gmail_list',
      'gws_gmail_read',
      'gws_gmail_send',
      'gws_drive_list',
      'gws_drive_read',
      'gws_drive_search',
      'gws_sheets_read',
      'gws_sheets_write',
      'gws_calendar_list',
      'gws_calendar_create',
      'gws_docs_read',
      'gws_tasks_list',
      'gws_tasks_create',
      'gws_people_search',
      'gws_raw',
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
