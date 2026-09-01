/**
 * outputSchema Wave 3 — drift guard for messages / health / shortcuts.
 *
 * Extends the Wave 1/2 contract to modules that were 0% before:
 *   messages:  list_chats, read_chat, search_chats, list_participants
 *   health:    health_today_steps, health_heart_rate, health_sleep
 *   shortcuts: list_shortcuts, search_shortcuts, get_shortcut_detail
 *
 * When one of these fails, the fix is almost always in the handler's
 * outputSchema declaration — the payload mirrors the real runtime JSON shape.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const { mockRunJxa, mockRunSwift, mockCheckSwiftBridge } = setupPlatformMocks();
const { registerMessagesTools } = await import('../dist/messages/tools.js');
const { registerHealthTools } = await import('../dist/health/tools.js');
const { registerShortcutsTools } = await import('../dist/shortcuts/tools.js');

function schemaFor(server, toolName) {
  const tool = server._tools.get(toolName);
  expect(tool).toBeDefined();
  expect(tool.opts.outputSchema).toBeDefined();
  return z.object(tool.opts.outputSchema).strict();
}

function assertConforms(server, toolName, structured) {
  const schema = schemaFor(server, toolName);
  const parsed = schema.safeParse(structured);
  if (!parsed.success) {
    throw new Error(`${toolName} drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
}

function resetAll() {
  mockRunJxa.mockReset();
  if (mockRunSwift) mockRunSwift.mockReset();
  if (mockCheckSwiftBridge) {
    mockCheckSwiftBridge.mockReset();
    mockCheckSwiftBridge.mockResolvedValue(null); // Swift bridge available for health tests
  }
}

// ── messages ──────────────────────────────────────────────────────────

const aliceChat = {
  id: 'chat-1',
  name: 'Alice',
  participants: [{ name: 'Alice', handle: 'alice@example.com' }],
  updated: '2026-04-20T10:00:00Z',
};
const anonymousChat = {
  id: 'chat-2',
  name: null,
  participants: [{ name: null, handle: '+821012345678' }],
  updated: null,
};
const teamChat = {
  id: 'chat-3',
  name: 'Team',
  participants: [
    { name: 'Bob', handle: 'bob@example.com' },
    { name: null, handle: null },
  ],
  updated: '2026-04-20T10:00:00Z',
};

describe('Wave 3 — messages.list_chats', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMessagesTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ total: 2, returned: 2, chats: [aliceChat, anonymousChat] });
    const result = await server.callTool('list_chats', {});
    assertConforms(server, 'list_chats', result.structuredContent);
  });
});

describe('Wave 3 — messages.read_chat', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMessagesTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue(aliceChat);
    const result = await server.callTool('read_chat', { chatId: 'chat-1' });
    assertConforms(server, 'read_chat', result.structuredContent);
  });
});

describe('Wave 3 — messages.search_chats', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMessagesTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ total: 5, returned: 1, chats: [teamChat] });
    const result = await server.callTool('search_chats', { query: 'team' });
    assertConforms(server, 'search_chats', result.structuredContent);
  });
});

describe('Wave 3 — messages.list_participants', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMessagesTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      chatId: 'chat-1',
      chatName: 'Alice',
      participants: [
        { name: 'Alice', handle: 'alice@example.com' },
        { name: null, handle: null },
      ],
    });
    const result = await server.callTool('list_participants', { chatId: 'chat-1' });
    assertConforms(server, 'list_participants', result.structuredContent);
  });
});

// ── health ────────────────────────────────────────────────────────────

describe('Wave 3 — health.health_today_steps', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerHealthTools(server, createMockConfig());
    mockRunSwift.mockResolvedValue({ stepsToday: 8432 });
    const result = await server.callTool('health_today_steps', {});
    assertConforms(server, 'health_today_steps', result.structuredContent);
  });
});

describe('Wave 3 — health.health_heart_rate', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema (null case)', async () => {
    const server = createMockServer();
    registerHealthTools(server, createMockConfig());
    mockRunSwift.mockResolvedValue({ heartRateAvg7d: null, message: 'insufficient data' });
    const result = await server.callTool('health_heart_rate', {});
    assertConforms(server, 'health_heart_rate', result.structuredContent);
  });

  test('structuredContent matches outputSchema (value case)', async () => {
    const server = createMockServer();
    registerHealthTools(server, createMockConfig());
    mockRunSwift.mockResolvedValue({ heartRateAvg7d: 62.3 });
    const result = await server.callTool('health_heart_rate', {});
    assertConforms(server, 'health_heart_rate', result.structuredContent);
  });
});

describe('Wave 3 — health.health_sleep', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerHealthTools(server, createMockConfig());
    mockRunSwift.mockResolvedValue({ sleepHours: 7.25 });
    const result = await server.callTool('health_sleep', {});
    assertConforms(server, 'health_sleep', result.structuredContent);
  });
});

// ── shortcuts ─────────────────────────────────────────────────────────

describe('Wave 3 — shortcuts.list_shortcuts', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerShortcutsTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ total: 3, shortcuts: ['A', 'B', 'C'] });
    const result = await server.callTool('list_shortcuts', {});
    assertConforms(server, 'list_shortcuts', result.structuredContent);
  });
});

describe('Wave 3 — shortcuts.search_shortcuts', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerShortcutsTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ total: 1, shortcuts: ['Daily Brief'] });
    const result = await server.callTool('search_shortcuts', { query: 'daily' });
    assertConforms(server, 'search_shortcuts', result.structuredContent);
  });
});

describe('Wave 3 — shortcuts.get_shortcut_detail', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerShortcutsTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ shortcut: 'Daily Brief', detail: 'actions: Get URL, Text' });
    const result = await server.callTool('get_shortcut_detail', { name: 'Daily Brief' });
    assertConforms(server, 'get_shortcut_detail', result.structuredContent);
  });
});
