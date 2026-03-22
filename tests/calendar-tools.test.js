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

const { registerCalendarTools } = await import('../dist/calendar/tools.js');

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

describe('Calendar tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerCalendarTools(server, {});
  });

  test('registers all 10 calendar tools', () => {
    expect(server.tools.size).toBe(10);
    const expected = [
      'list_calendars',
      'list_events',
      'read_event',
      'create_event',
      'update_event',
      'delete_event',
      'search_events',
      'get_upcoming_events',
      'today_events',
      'create_recurring_event',
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
      'list_calendars', 'list_events', 'read_event',
      'search_events', 'get_upcoming_events', 'today_events',
    ];
    for (const name of readOnly) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('update_event and delete_event are destructive', () => {
    for (const name of ['update_event', 'delete_event']) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });

  test('create_event is not destructive', () => {
    const { config } = server.tools.get('create_event');
    expect(config.annotations.destructiveHint).toBe(false);
  });
});
