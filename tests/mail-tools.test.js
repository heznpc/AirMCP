import { describe, test, expect, jest } from '@jest/globals';

const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerMailTools } = await import('../dist/mail/tools.js');

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

describe('Mail tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerMailTools(server, {});
  });

  test('registers all 11 mail tools', () => {
    expect(server.tools.size).toBe(11);
    const expected = [
      'list_mailboxes',
      'list_messages',
      'read_message',
      'search_messages',
      'mark_message_read',
      'flag_message',
      'get_unread_count',
      'move_message',
      'list_accounts',
      'send_mail',
      'reply_mail',
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
      'list_mailboxes', 'list_messages', 'read_message',
      'search_messages', 'get_unread_count', 'list_accounts',
    ];
    for (const name of readOnly) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('send_mail and reply_mail are destructive', () => {
    for (const name of ['send_mail', 'reply_mail']) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });

  test('move_message is destructive', () => {
    const { config } = server.tools.get('move_message');
    expect(config.annotations.destructiveHint).toBe(true);
  });
});

describe('Mail tool gating', () => {
  test('send_mail is blocked when allowSendMail is false', async () => {
    const server = createMockServer();
    registerMailTools(server, { allowSendMail: false });

    const result = await server.callTool('send_mail', {
      to: ['test@example.com'],
      subject: 'Test',
      body: 'Test body',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disabled');
  });

  test('reply_mail is blocked when allowSendMail is false', async () => {
    const server = createMockServer();
    registerMailTools(server, { allowSendMail: false });

    const result = await server.callTool('reply_mail', {
      id: 'msg-123',
      body: 'Reply body',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disabled');
  });
});
