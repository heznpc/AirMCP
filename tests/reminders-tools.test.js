import { describe, test, expect, jest } from '@jest/globals';

const mockRunAutomation = jest.fn();
const mockRunSwift = jest.fn();

jest.unstable_mockModule('../dist/shared/automation.js', () => ({
  runAutomation: mockRunAutomation,
}));

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: jest.fn(),
}));

const { registerReminderTools } = await import('../dist/reminders/tools.js');

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

describe('Reminders tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerReminderTools(server, {});
  });

  test('registers all 11 reminder tools', () => {
    expect(server.tools.size).toBe(11);
    const expected = [
      'list_reminder_lists',
      'list_reminders',
      'read_reminder',
      'create_reminder',
      'update_reminder',
      'complete_reminder',
      'delete_reminder',
      'search_reminders',
      'create_reminder_list',
      'delete_reminder_list',
      'create_recurring_reminder',
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
    const readOnly = ['list_reminder_lists', 'list_reminders', 'read_reminder', 'search_reminders'];
    for (const name of readOnly) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('destructive tools are correctly marked', () => {
    const destructive = ['update_reminder', 'delete_reminder', 'delete_reminder_list'];
    for (const name of destructive) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });

  test('complete_reminder is not destructive', () => {
    const { config } = server.tools.get('complete_reminder');
    expect(config.annotations.destructiveHint).toBe(false);
  });

  test('create tools are not destructive', () => {
    const creates = ['create_reminder', 'create_reminder_list', 'create_recurring_reminder'];
    for (const name of creates) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });
});
