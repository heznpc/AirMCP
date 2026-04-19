/**
 * outputSchema Wave 2 — drift guard for the next tier of read tools.
 *
 * See output-schema-wave1.test.js for the rationale. This file extends the
 * same strict-parse check to:
 *   notes: read_note, list_folders
 *   reminders: list_reminder_lists, read_reminder
 *   calendar: list_calendars, read_event
 *   mail: list_messages, list_accounts
 *   contacts: list_groups
 *   safari: list_bookmarks, list_reading_list
 *   finder: list_directory
 *   music: list_playlists, list_tracks
 *
 * When one of these fails, the fix is almost always in the handler's
 * outputSchema declaration (add the missing field / fix the type), not in
 * the test payload — the payload mirrors the real runtime JSON shape.
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
const { registerMailTools } = await import('../dist/mail/tools.js');
const { registerContactTools } = await import('../dist/contacts/tools.js');
const { registerSafariTools } = await import('../dist/safari/tools.js');
const { registerFinderTools } = await import('../dist/finder/tools.js');
const { registerMusicTools } = await import('../dist/music/tools.js');

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
  if (mockRunAutomation) mockRunAutomation.mockReset();
}

// ── notes ─────────────────────────────────────────────────────────────

describe('Wave 2 — notes.read_note', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      id: 'x-coredata://NOTE/1',
      name: 'Title',
      body: '<p>body</p>',
      plaintext: 'body',
      creationDate: '2026-01-01T00:00:00Z',
      modificationDate: '2026-01-02T00:00:00Z',
      folder: 'Notes',
      shared: false,
      passwordProtected: false,
    });
    const result = await server.callTool('read_note', { id: 'x-coredata://NOTE/1' });
    expect(result.structuredContent).toBeDefined();
    assertConforms(server, 'read_note', result.structuredContent);
  });
});

describe('Wave 2 — notes.list_folders', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerNoteTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue([
      { id: 'f1', name: 'Work', account: 'iCloud', noteCount: 10, shared: false },
      { id: 'f2', name: 'Shared', account: 'iCloud', noteCount: 3, shared: true },
    ]);
    const result = await server.callTool('list_folders', {});
    assertConforms(server, 'list_folders', result.structuredContent);
  });
});

// ── reminders ─────────────────────────────────────────────────────────

describe('Wave 2 — reminders.list_reminder_lists', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerReminderTools(server, createMockConfig());
    const payload = [
      { id: 'l1', name: 'Reminders', reminderCount: 7 },
      { id: 'l2', name: 'Work', reminderCount: 0 },
    ];
    mockRunAutomation.mockResolvedValue(payload);
    mockRunJxa.mockResolvedValue(payload);
    const result = await server.callTool('list_reminder_lists', {});
    assertConforms(server, 'list_reminder_lists', result.structuredContent);
  });
});

describe('Wave 2 — reminders.read_reminder', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerReminderTools(server, createMockConfig());
    const payload = {
      id: 'r1',
      name: 'Buy milk',
      body: '',
      completed: false,
      completionDate: null,
      creationDate: '2026-01-01T00:00:00Z',
      modificationDate: '2026-01-02T00:00:00Z',
      dueDate: null,
      priority: 0,
      flagged: false,
      list: 'Reminders',
    };
    mockRunAutomation.mockResolvedValue(payload);
    mockRunJxa.mockResolvedValue(payload);
    const result = await server.callTool('read_reminder', { id: 'r1' });
    assertConforms(server, 'read_reminder', result.structuredContent);
  });
});

// ── calendar ──────────────────────────────────────────────────────────

describe('Wave 2 — calendar.list_calendars', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerCalendarTools(server, createMockConfig());
    const payload = [
      { id: 'c1', name: 'Work', color: '#ff0000', writable: true },
      { id: 'c2', name: 'Holidays', color: null, writable: false },
    ];
    mockRunAutomation.mockResolvedValue(payload);
    mockRunJxa.mockResolvedValue(payload);
    const result = await server.callTool('list_calendars', {});
    assertConforms(server, 'list_calendars', result.structuredContent);
  });
});

describe('Wave 2 — calendar.read_event', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerCalendarTools(server, createMockConfig());
    const payload = {
      id: 'e1',
      summary: 'Standup',
      description: null,
      location: null,
      startDate: '2026-04-20T09:00:00Z',
      endDate: '2026-04-20T09:30:00Z',
      allDay: false,
      recurrence: null,
      url: null,
      calendar: 'Work',
      attendees: [{ name: 'Alice', email: 'a@example.com', status: 'accepted' }],
    };
    mockRunAutomation.mockResolvedValue(payload);
    mockRunJxa.mockResolvedValue(payload);
    const result = await server.callTool('read_event', { id: 'e1' });
    assertConforms(server, 'read_event', result.structuredContent);
  });
});

// ── mail ──────────────────────────────────────────────────────────────

describe('Wave 2 — mail.list_messages', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMailTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 1,
      offset: 0,
      returned: 1,
      messages: [
        {
          id: '123',
          subject: 'Hello',
          sender: 'a@example.com',
          dateReceived: '2026-04-20T09:00:00Z',
          read: false,
          flagged: false,
        },
      ],
    });
    const result = await server.callTool('list_messages', { mailbox: 'INBOX', limit: 50, offset: 0 });
    assertConforms(server, 'list_messages', result.structuredContent);
  });
});

describe('Wave 2 — mail.list_accounts', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMailTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue([
      { name: 'iCloud', fullName: 'Example User', emailAddresses: ['a@icloud.com'] },
    ]);
    const result = await server.callTool('list_accounts', {});
    assertConforms(server, 'list_accounts', result.structuredContent);
  });
});

// ── contacts ─────────────────────────────────────────────────────────

describe('Wave 2 — contacts.list_groups', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerContactTools(server, createMockConfig());
    const payload = [{ id: 'g1', name: 'Family' }];
    mockRunAutomation.mockResolvedValue(payload);
    mockRunJxa.mockResolvedValue(payload);
    const result = await server.callTool('list_groups', {});
    assertConforms(server, 'list_groups', result.structuredContent);
  });
});

// ── safari ───────────────────────────────────────────────────────────

describe('Wave 2 — safari.list_bookmarks', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerSafariTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      count: 1,
      bookmarks: [{ title: 'MCP', url: 'https://modelcontextprotocol.io', folder: 'Work' }],
    });
    const result = await server.callTool('list_bookmarks', {});
    assertConforms(server, 'list_bookmarks', result.structuredContent);
  });
});

describe('Wave 2 — safari.list_reading_list', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerSafariTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      count: 1,
      items: [{ title: 'Article', url: 'https://example.com/a' }],
    });
    const result = await server.callTool('list_reading_list', {});
    assertConforms(server, 'list_reading_list', result.structuredContent);
  });
});

// ── finder ───────────────────────────────────────────────────────────

describe('Wave 2 — finder.list_directory', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerFinderTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 2,
      returned: 2,
      items: [
        { name: 'foo.txt', kind: 'Plain Text Document', size: 123, modificationDate: '2026-04-20T09:00:00Z' },
        { name: 'bar', kind: 'Folder' },
      ],
    });
    // Mock server doesn't apply Zod `.default()` — pass limit explicitly.
    const result = await server.callTool('list_directory', { path: '/Users/test', limit: 100 });
    assertConforms(server, 'list_directory', result.structuredContent);
  });
});

// ── music ────────────────────────────────────────────────────────────

describe('Wave 2 — music.list_playlists', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMusicTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue([
      { id: 'p1', name: 'Liked', duration: 3600, trackCount: 50 },
    ]);
    const result = await server.callTool('list_playlists', {});
    assertConforms(server, 'list_playlists', result.structuredContent);
  });
});

describe('Wave 2 — music.list_tracks', () => {
  beforeEach(resetAll);
  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerMusicTools(server, createMockConfig());
    mockRunJxa.mockResolvedValue({
      total: 1,
      returned: 1,
      tracks: [
        {
          id: 't1',
          name: 'Song',
          artist: 'Artist',
          album: 'Album',
          duration: 200,
          trackNumber: 3,
          genre: 'Pop',
          year: 2024,
        },
      ],
    });
    const result = await server.callTool('list_tracks', { playlist: 'Liked', limit: 100 });
    assertConforms(server, 'list_tracks', result.structuredContent);
  });
});
