/**
 * outputSchema Wave 4 — drift guard for notes / mail / finder / safari
 * read tools. Extends Wave 1/2/3 coverage by 7 more tools, bringing the
 * high-traffic read surface from ~40% → ~55%.
 *
 * Tools covered:
 *   mail:    read_message, search_messages
 *   finder:  search_files, recent_files
 *   safari:  read_page_content, search_tabs
 *   notes:   scan_notes
 *
 * Each case seeds `runJxa` with a hand-rolled fixture shaped like the
 * real JXA return, calls the tool through the mock server, and asserts
 * `structuredContent` parses through the tool's own `outputSchema` under
 * strict Zod. A drift between handler return shape and schema surfaces
 * here instead of at the first LLM call.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const { mockRunJxa } = setupPlatformMocks();
const { registerMailTools } = await import('../dist/mail/tools.js');
const { registerFinderTools } = await import('../dist/finder/tools.js');
const { registerSafariTools } = await import('../dist/safari/tools.js');
const { registerNoteTools } = await import('../dist/notes/tools.js');

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
}

// ── mail ──────────────────────────────────────────────────────────────

// Mock-server calls handlers directly without running them through the
// MCP SDK's zod inputSchema validator, so tests must pass the defaults
// explicitly — otherwise tools that use `safeInt` / `safeString` on
// optional-with-default args throw "Expected safe integer, got undefined".

describe('Wave 4 — mail.read_message', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema (with cc + dateSent)', async () => {
    const server = createMockServer();
    registerMailTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      id: '123',
      subject: 'Release notes',
      sender: 'Alice <alice@example.com>',
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [{ name: null, address: 'cc@example.com' }],
      dateReceived: '2026-04-24T10:00:00Z',
      dateSent: '2026-04-24T09:59:30Z',
      read: true,
      flagged: false,
      content: 'Hello…',
      mailbox: 'INBOX',
      account: 'Personal',
    });
    const result = await server.callTool('read_message', { id: '123', maxLength: 5000 });
    assertConforms(server, 'read_message', result.structuredContent);
  });

  test('structuredContent accepts dateSent=null (not-yet-sent drafts)', async () => {
    const server = createMockServer();
    registerMailTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      id: '99',
      subject: 'Draft',
      sender: 'me@example.com',
      to: [],
      cc: [],
      dateReceived: '2026-04-24T10:00:00Z',
      dateSent: null,
      read: false,
      flagged: false,
      content: '',
      mailbox: 'Drafts',
      account: 'Personal',
    });
    const result = await server.callTool('read_message', { id: '99', maxLength: 5000 });
    assertConforms(server, 'read_message', result.structuredContent);
  });
});

describe('Wave 4 — mail.search_messages', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMailTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      returned: 2,
      messages: [
        { id: '1', subject: 'Re: launch', sender: 'Alice', dateReceived: '2026-04-24T10:00:00Z', read: true },
        { id: '2', subject: 'Launch plan', sender: 'Bob', dateReceived: null, read: false },
      ],
    });
    const result = await server.callTool('search_messages', { query: 'launch', mailbox: 'INBOX', limit: 30 });
    assertConforms(server, 'search_messages', result.structuredContent);
  });
});

// ── finder ────────────────────────────────────────────────────────────

describe('Wave 4 — finder.search_files', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema (full metadata rows)', async () => {
    const server = createMockServer();
    registerFinderTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 2,
      files: [
        {
          path: '/Users/me/notes.md',
          name: 'notes.md',
          size: 1234,
          modificationDate: '2026-04-24T10:00:00Z',
        },
        {
          path: '/Users/me/todo.txt',
          name: 'todo.txt',
          size: 80,
          modificationDate: '2026-04-23T10:00:00Z',
        },
      ],
    });
    const result = await server.callTool('search_files', { query: 'notes', folder: '/Users/me', limit: 50 });
    assertConforms(server, 'search_files', result.structuredContent);
  });

  test('structuredContent accepts fallback rows with only path + name', async () => {
    // The script's try/catch emits a minimal shape when stat() fails.
    // Schema must tolerate that without dropping the row.
    const server = createMockServer();
    registerFinderTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 1,
      files: [{ path: '/protected/file', name: 'file' }],
    });
    const result = await server.callTool('search_files', { query: 'x', folder: '~', limit: 50 });
    assertConforms(server, 'search_files', result.structuredContent);
  });

  test('structuredContent accepts modificationDate=null', async () => {
    const server = createMockServer();
    registerFinderTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 1,
      files: [{ path: '/a', name: 'a', size: 0, modificationDate: null }],
    });
    const result = await server.callTool('search_files', { query: 'x', folder: '~', limit: 50 });
    assertConforms(server, 'search_files', result.structuredContent);
  });
});

describe('Wave 4 — finder.recent_files', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerFinderTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 2,
      files: [
        { path: '/Users/me/a.md', name: 'a.md' },
        { path: '/Users/me/b.txt', name: 'b.txt' },
      ],
    });
    const result = await server.callTool('recent_files', { folder: '~', days: 7, limit: 30 });
    assertConforms(server, 'recent_files', result.structuredContent);
  });
});

// ── safari ────────────────────────────────────────────────────────────

describe('Wave 4 — safari.read_page_content', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerSafariTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      title: 'Example',
      url: 'https://example.com/',
      content: '<html>…</html>',
      truncated: false,
    });
    const result = await server.callTool('read_page_content', { windowIndex: 0, tabIndex: 0, maxLength: 10000 });
    assertConforms(server, 'read_page_content', result.structuredContent);
  });

  test('structuredContent handles truncated=true', async () => {
    const server = createMockServer();
    registerSafariTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      title: 'Big page',
      url: 'https://x.example/',
      content: 'a'.repeat(10000),
      truncated: true,
    });
    const result = await server.callTool('read_page_content', { windowIndex: 0, tabIndex: 0, maxLength: 10000 });
    assertConforms(server, 'read_page_content', result.structuredContent);
  });
});

describe('Wave 4 — safari.search_tabs', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerSafariTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      returned: 2,
      tabs: [
        { windowIndex: 0, tabIndex: 0, title: 'Example', url: 'https://example.com/' },
        { windowIndex: 0, tabIndex: 1, title: 'Other', url: 'https://other.example/' },
      ],
    });
    const result = await server.callTool('search_tabs', { query: 'example' });
    assertConforms(server, 'search_tabs', result.structuredContent);
  });

  test('structuredContent handles empty tab list', async () => {
    const server = createMockServer();
    registerSafariTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ returned: 0, tabs: [] });
    const result = await server.callTool('search_tabs', { query: 'zzz' });
    assertConforms(server, 'search_tabs', result.structuredContent);
  });
});

// ── notes ─────────────────────────────────────────────────────────────

describe('Wave 4 — notes.scan_notes', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 2,
      offset: 0,
      returned: 2,
      notes: [
        {
          id: 'x-coredata://1',
          name: 'Meeting',
          folder: 'Work',
          creationDate: '2026-04-20T10:00:00Z',
          modificationDate: '2026-04-24T10:00:00Z',
          preview: 'Discussed …',
          charCount: 120,
          shared: false,
        },
        {
          id: 'x-coredata://2',
          name: 'Recipe',
          folder: 'Personal',
          creationDate: '2026-01-01T10:00:00Z',
          modificationDate: '2026-01-05T10:00:00Z',
          preview: 'Flour, eggs, …',
          charCount: 80,
          shared: true,
        },
      ],
    });
    const result = await server.callTool('scan_notes', { limit: 100, offset: 0, previewLength: 300 });
    assertConforms(server, 'scan_notes', result.structuredContent);
  });

  test('structuredContent handles empty notes list', async () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({ total: 0, offset: 0, returned: 0, notes: [] });
    const result = await server.callTool('scan_notes', { folder: 'Empty', limit: 100, offset: 0, previewLength: 300 });
    assertConforms(server, 'scan_notes', result.structuredContent);
  });
});
