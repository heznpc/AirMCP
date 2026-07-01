/**
 * outputSchema Wave 1 — drift guard.
 *
 * MCP's `structuredContent` is validated against each tool's `outputSchema`
 * on the client side, but we have no server-side check that the runtime
 * JSON the handler returns actually conforms to the schema it declared.
 * Over time the two drift: a new field in the JXA script that isn't
 * added to the Zod object, a field renamed on the Swift side but not the
 * schema, etc. This file closes that gap for the three highest-traffic
 * read tools — list/search notes, list/search reminders, and list_events — by calling each
 * tool against mocked runtimes and running the captured structuredContent
 * through the tool's own outputSchema via z.object(...).strict().safeParse().
 *
 * The .strict() call is load-bearing: without it, handlers emitting an
 * undeclared field (the most common drift mode) slip through silently.
 *
 * If this test fails, either:
 *   - the handler is emitting a field the schema forgot to declare, or
 *   - the handler is emitting the wrong type for a declared field.
 * Both are bugs. The fix is usually in `outputSchema`, not in the test.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const { mockRunJxa, mockRunAutomation } = setupPlatformMocks();
const { registerNoteTools } = await import('../dist/notes/tools.js');
const { registerReminderTools } = await import('../dist/reminders/tools.js');
const { registerCalendarTools } = await import('../dist/calendar/tools.js');

function schemaFor(server, toolName) {
  const tool = server._tools.get(toolName);
  expect(tool).toBeDefined();
  expect(tool.opts.outputSchema).toBeDefined();
  // .strict() rejects undeclared keys — catches the "handler added a new field
  // but forgot to update outputSchema" case, which is the #1 drift mode.
  return z.object(tool.opts.outputSchema).strict();
}

describe('outputSchema Wave 1 — list_notes', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('runtime response conforms to declared outputSchema', async () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());

    mockRunJxa.mockResolvedValue({
      total: 2,
      offset: 0,
      returned: 2,
      notes: [
        { id: 'a', name: 'A', folder: 'Notes', shared: false, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
        { id: 'b', name: 'B', folder: 'Work', shared: false, creationDate: '2024-01-03', modificationDate: '2024-01-04' },
      ],
    });

    const result = await server.callTool('list_notes', {});
    expect(result.structuredContent).toBeDefined();

    const schema = schemaFor(server, 'list_notes');
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(`list_notes drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
  });
});

describe('outputSchema Wave 1 — search_notes', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('runtime response conforms to declared outputSchema', async () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());

    mockRunJxa.mockResolvedValue({
      total: 2,
      totalMatched: 1,
      offset: 0,
      returned: 1,
      notes: [
        {
          id: 'a',
          name: 'A',
          folder: 'Notes',
          preview: 'needle preview',
          creationDate: '2024-01-01',
          modificationDate: '2024-01-02',
          shared: false,
        },
      ],
    });

    const result = await server.callTool('search_notes', { query: 'needle' });
    expect(result.structuredContent).toBeDefined();

    const schema = schemaFor(server, 'search_notes');
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(`search_notes drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
  });
});

describe('outputSchema Wave 1 — list_reminders', () => {
  beforeEach(() => {
    if (mockRunAutomation) mockRunAutomation.mockReset();
    mockRunJxa.mockReset();
  });

  test('runtime response conforms to declared outputSchema', async () => {
    const server = createMockServer();
    registerReminderTools(server, createMockConfig());

    const payload = {
      total: 1,
      offset: 0,
      returned: 1,
      reminders: [
        {
          id: 'r1',
          name: 'Buy milk',
          completed: false,
          dueDate: '2026-04-20T09:00:00Z',
          priority: 0,
          flagged: false,
          list: 'Reminders',
        },
      ],
    };

    // Reminder tools use runAutomation (swift-preferred, jxa fallback).
    if (mockRunAutomation) {
      mockRunAutomation.mockResolvedValue(payload);
    }
    mockRunJxa.mockResolvedValue(payload);

    const result = await server.callTool('list_reminders', {});
    expect(result.structuredContent).toBeDefined();

    const schema = schemaFor(server, 'list_reminders');
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(`list_reminders drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
  });
});

describe('outputSchema Wave 1 — search_reminders', () => {
  beforeEach(() => {
    if (mockRunAutomation) mockRunAutomation.mockReset();
    mockRunJxa.mockReset();
  });

  test('runtime response conforms to declared outputSchema', async () => {
    const server = createMockServer();
    registerReminderTools(server, createMockConfig());

    const payload = {
      returned: 1,
      reminders: [
        {
          id: 'r1',
          name: 'Buy milk',
          completed: false,
          dueDate: null,
          priority: 0,
          flagged: false,
          list: 'Reminders',
        },
      ],
    };

    if (mockRunAutomation) {
      mockRunAutomation.mockResolvedValue(payload);
    }
    mockRunJxa.mockResolvedValue(payload);

    const result = await server.callTool('search_reminders', { query: 'milk' });
    expect(result.structuredContent).toBeDefined();

    const schema = schemaFor(server, 'search_reminders');
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(`search_reminders drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
  });
});

describe('outputSchema Wave 1 — list_events', () => {
  beforeEach(() => {
    if (mockRunAutomation) mockRunAutomation.mockReset();
    mockRunJxa.mockReset();
  });

  test('runtime response conforms to declared outputSchema', async () => {
    const server = createMockServer();
    registerCalendarTools(server, createMockConfig());

    const payload = {
      total: 1,
      offset: 0,
      returned: 1,
      events: [
        {
          id: 'e1',
          summary: 'Standup',
          startDate: '2026-04-20T09:00:00Z',
          endDate: '2026-04-20T09:30:00Z',
          allDay: false,
          calendar: 'Work',
        },
      ],
    };

    if (mockRunAutomation) {
      mockRunAutomation.mockResolvedValue(payload);
    }
    mockRunJxa.mockResolvedValue(payload);

    const result = await server.callTool('list_events', {
      startDate: '2026-04-20T00:00:00Z',
      endDate: '2026-04-21T00:00:00Z',
    });
    expect(result.structuredContent).toBeDefined();

    const schema = schemaFor(server, 'list_events');
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(`list_events drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
  });
});

describe('outputSchema Wave 1 — schema smoke', () => {
  test('schemas reject obviously wrong shapes', () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());
    const schema = schemaFor(server, 'list_notes');

    const bad = schema.safeParse({ total: 'not a number', notes: [] });
    expect(bad.success).toBe(false);
  });
});
