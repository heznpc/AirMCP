import { describe, test, expect, jest } from '@jest/globals';

const mockRunAutomation = jest.fn();

jest.unstable_mockModule('../dist/shared/automation.js', () => ({
  runAutomation: mockRunAutomation,
}));

const { registerContactTools } = await import('../dist/contacts/tools.js');

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

describe('Contacts tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerContactTools(server, {});
  });

  test('registers all 10 contacts tools', () => {
    expect(server.tools.size).toBe(10);
    const expected = [
      'list_contacts',
      'search_contacts',
      'read_contact',
      'create_contact',
      'update_contact',
      'delete_contact',
      'list_groups',
      'add_contact_email',
      'add_contact_phone',
      'list_group_members',
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
    const readOnly = ['list_contacts', 'search_contacts', 'read_contact', 'list_groups', 'list_group_members'];
    for (const name of readOnly) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('delete_contact and update_contact are destructive', () => {
    // update overwrites data, delete removes it
    for (const name of ['delete_contact', 'update_contact']) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });

  test('create_contact is not destructive', () => {
    const { config } = server.tools.get('create_contact');
    expect(config.annotations.destructiveHint).toBe(false);
  });
});
