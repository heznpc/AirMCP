/**
 * Script ↔ outputSchema contract test.
 *
 * Wave 1/2/3 runtime tests mock `runJxa`/`runSwift`, so the mock return value
 * becomes the `structuredContent` verbatim — those tests can only confirm
 * that a schema is self-consistent with whatever shape the test wrote down.
 * They cannot detect a real drift where `scripts.ts` changes the JSON it
 * emits without the matching outputSchema update (or vice versa).
 *
 * This file closes that gap for the Wave 3 JXA modules (messages, shortcuts).
 * Each `scripts.ts` exports a hand-maintained `*_EXAMPLE` constant pinned to
 * the same TypeScript interface the script's final `JSON.stringify(...)` is
 * expected to produce. Here we parse every example through the tool's real
 * declared `outputSchema` via strict Zod. A developer who edits one side
 * (script → new field, or outputSchema → renamed field) without touching
 * the other fails this test even before running a Mac.
 *
 * Scope: JXA-backed tools only. Swift-bridge tools (health_*, some photos)
 * need a different contract (Swift `--dump-schema` or similar) and are
 * tracked separately.
 */
import { describe, test, expect } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

setupPlatformMocks();

const { registerMessagesTools } = await import('../dist/messages/tools.js');
const { registerShortcutsTools } = await import('../dist/shortcuts/tools.js');
const messagesScripts = await import('../dist/messages/scripts.js');
const shortcutsScripts = await import('../dist/shortcuts/scripts.js');

function schemaFor(server, toolName) {
  const tool = server._tools.get(toolName);
  expect(tool).toBeDefined();
  expect(tool.opts.outputSchema).toBeDefined();
  return z.object(tool.opts.outputSchema).strict();
}

function assertExampleFits(server, toolName, example) {
  const schema = schemaFor(server, toolName);
  const result = schema.safeParse(example);
  if (!result.success) {
    throw new Error(
      `${toolName}: scripts.ts example drifted from outputSchema. ` +
        `Issues: ${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
}

describe('Script shape ↔ outputSchema contract — messages', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerMessagesTools(server, createMockConfig());
  });

  test('list_chats example conforms', () => {
    assertExampleFits(server, 'list_chats', messagesScripts.LIST_CHATS_EXAMPLE);
  });
  test('read_chat example conforms', () => {
    assertExampleFits(server, 'read_chat', messagesScripts.READ_CHAT_EXAMPLE);
  });
  test('search_chats example conforms', () => {
    assertExampleFits(server, 'search_chats', messagesScripts.SEARCH_CHATS_EXAMPLE);
  });
  test('list_participants example conforms', () => {
    assertExampleFits(server, 'list_participants', messagesScripts.LIST_PARTICIPANTS_EXAMPLE);
  });
});

describe('Script shape ↔ outputSchema contract — shortcuts', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerShortcutsTools(server, createMockConfig());
  });

  test('list_shortcuts example conforms', () => {
    assertExampleFits(server, 'list_shortcuts', shortcutsScripts.LIST_SHORTCUTS_EXAMPLE);
  });
  test('search_shortcuts example conforms', () => {
    assertExampleFits(server, 'search_shortcuts', shortcutsScripts.SEARCH_SHORTCUTS_EXAMPLE);
  });
  test('get_shortcut_detail example conforms', () => {
    assertExampleFits(server, 'get_shortcut_detail', shortcutsScripts.GET_SHORTCUT_DETAIL_EXAMPLE);
  });
});
