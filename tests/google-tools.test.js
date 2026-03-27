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

describe('gws_raw security whitelist', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerGoogleTools(server, { allowSendMail: false });
  });

  test('rejects unknown service', async () => {
    const result = await server.callTool('gws_raw', {
      service: 'malicious_service', resource: 'foo', method: 'list',
    });
    expect(result.content[0].text).toContain('Unknown service');
    expect(result.content[0].text).toContain('malicious_service');
  });

  test('allows known services', async () => {
    const { runGws } = await import('../dist/google/gws.js');
    runGws.mockResolvedValue({ ok: true });

    const result = await server.callTool('gws_raw', {
      service: 'gmail', resource: 'users.messages', method: 'list',
    });
    expect(result.content[0].text).not.toContain('Unknown service');
  });

  test('blocks destructive methods when allowSendMail is false', async () => {
    for (const method of ['delete', 'trash', 'remove', 'purge']) {
      const result = await server.callTool('gws_raw', {
        service: 'drive', resource: 'files', method,
      });
      expect(result.content[0].text).toContain('Destructive method');
      expect(result.content[0].text).toContain(method);
    }
  });

  test('blocks gmail send when allowSendMail is false', async () => {
    const result = await server.callTool('gws_raw', {
      service: 'gmail', resource: 'users.messages', method: 'send',
    });
    expect(result.content[0].text).toContain('disabled');
  });

  test('allows destructive methods when allowSendMail is true', async () => {
    const permissiveServer = createMockServer();
    registerGoogleTools(permissiveServer, { allowSendMail: true });

    const { runGws } = await import('../dist/google/gws.js');
    runGws.mockResolvedValue({ deleted: true });

    const result = await permissiveServer.callTool('gws_raw', {
      service: 'drive', resource: 'files', method: 'delete',
    });
    expect(result.content[0].text).not.toContain('Destructive method');
  });

  test('allows non-destructive methods freely', async () => {
    const { runGws } = await import('../dist/google/gws.js');
    runGws.mockResolvedValue({ items: [] });

    for (const method of ['list', 'get', 'create', 'update']) {
      const result = await server.callTool('gws_raw', {
        service: 'sheets', resource: 'spreadsheets', method,
      });
      expect(result.content[0].text).not.toContain('Destructive method');
    }
  });
});
