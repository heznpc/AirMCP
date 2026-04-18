import { describe, test, expect, beforeEach } from '@jest/globals';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

// Set up mocks before importing module under test
const { mockRunJxa } = setupPlatformMocks();
const { registerNoteTools } = await import('../dist/notes/tools.js');

// ── Helpers ──────────────────────────────────────────────────────────

function setup(configOverrides = {}) {
  const server = createMockServer();
  const config = createMockConfig(configOverrides);
  registerNoteTools(server, config);
  return { server, config };
}

const FAKE_NOTE_ID = 'x-coredata://12345/ICNote/p42';

// ── Registration ─────────────────────────────────────────────────────

describe('registerNoteTools', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('registers all expected note tools', () => {
    const { server } = setup();
    const names = [...server._tools.keys()];

    expect(names).toContain('list_notes');
    expect(names).toContain('search_notes');
    expect(names).toContain('read_note');
    expect(names).toContain('create_note');
    expect(names).toContain('update_note');
    expect(names).toContain('delete_note');
    expect(names).toContain('list_folders');
    expect(names).toContain('create_folder');
    expect(names).toContain('scan_notes');
    expect(names).toContain('compare_notes');
    expect(names).toContain('move_note');
    expect(names).toContain('bulk_move_notes');
  });

  test('read-only tools have correct annotations', () => {
    const { server } = setup();
    const readOnlyTools = ['list_notes', 'search_notes', 'read_note', 'list_folders', 'scan_notes', 'compare_notes'];

    for (const name of readOnlyTools) {
      const tool = server._tools.get(name);
      expect(tool.opts.annotations.readOnlyHint).toBe(true);
      expect(tool.opts.annotations.destructiveHint).toBe(false);
    }
  });

  test('destructive tools have correct annotations', () => {
    const { server } = setup();
    const destructiveTools = ['update_note', 'delete_note', 'move_note', 'bulk_move_notes'];

    for (const name of destructiveTools) {
      const tool = server._tools.get(name);
      expect(tool.opts.annotations.destructiveHint).toBe(true);
      expect(tool.opts.annotations.readOnlyHint).toBe(false);
    }
  });
});

// ── list_notes ───────────────────────────────────────────────────────

describe('list_notes', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns notes list from JXA', async () => {
    const { server } = setup();
    const jxaData = {
      total: 2,
      offset: 0,
      returned: 2,
      notes: [
        { id: 'id-1', name: 'Note 1', folder: 'Notes', shared: false, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
        { id: 'id-2', name: 'Note 2', folder: 'Work', shared: false, creationDate: '2024-01-03', modificationDate: '2024-01-04' },
      ],
    };
    mockRunJxa.mockResolvedValue(jxaData);

    const result = await server.callTool('list_notes', { limit: 200, offset: 0 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(2);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0].name).toBe('Note 1');
  });

  test('filters shared notes when includeShared=false', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue({
      total: 3,
      offset: 0,
      returned: 3,
      notes: [
        { id: 'id-1', name: 'My Note', folder: 'Notes', shared: false, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
        { id: 'id-2', name: 'Shared Note', folder: 'Notes', shared: true, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
        { id: 'id-3', name: 'Another', folder: 'Notes', shared: false, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
      ],
    });

    const result = await server.callTool('list_notes', { limit: 200, offset: 0 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.notes).toHaveLength(2);
    expect(parsed.returned).toBe(2);
    expect(parsed.notes.every(n => !n.shared)).toBe(true);
  });

  test('includes shared notes when includeShared=true', async () => {
    const { server } = setup({ includeShared: true });
    mockRunJxa.mockResolvedValue({
      total: 2,
      offset: 0,
      returned: 2,
      notes: [
        { id: 'id-1', name: 'My Note', folder: 'Notes', shared: false, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
        { id: 'id-2', name: 'Shared Note', folder: 'Notes', shared: true, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
      ],
    });

    const result = await server.callTool('list_notes', { limit: 200, offset: 0 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notes).toHaveLength(2);
  });

  test('returns error on JXA failure', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('Notes app not available'));

    const result = await server.callTool('list_notes', { limit: 200, offset: 0 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list notes');
    expect(result.content[0].text).toContain('Notes app not available');
  });
});

// ── search_notes ─────────────────────────────────────────────────────

describe('search_notes', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns search results with previews', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({
      total: 1,
      returned: 1,
      notes: [
        {
          id: 'id-1', name: 'Meeting Notes', folder: 'Work', shared: false,
          creationDate: '2024-01-01', modificationDate: '2024-01-02',
          preview: 'Discussion about Q4 planning...',
        },
      ],
    });

    const result = await server.callTool('search_notes', { query: 'meeting', limit: 50 });

    expect(result.isError).toBeUndefined();
    // search_notes uses okUntrusted, so the text includes the UNTRUSTED wrapper
    expect(result.content[0].text).toContain('UNTRUSTED');
    expect(result.content[0].text).toContain('Meeting Notes');
  });

  test('filters shared notes from search results', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue({
      total: 2,
      returned: 2,
      notes: [
        { id: 'id-1', name: 'My Note', folder: 'Notes', shared: false, preview: 'abc', creationDate: '2024-01-01', modificationDate: '2024-01-02' },
        { id: 'id-2', name: 'Shared', folder: 'Notes', shared: true, preview: 'def', creationDate: '2024-01-01', modificationDate: '2024-01-02' },
      ],
    });

    const result = await server.callTool('search_notes', { query: 'test', limit: 50 });
    const text = result.content[0].text;
    // Extract JSON from within the UNTRUSTED markers
    const jsonStr = text.split('\n').slice(1, -1).join('\n');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.returned).toBe(1);
  });

  test('returns error on JXA failure', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('timeout'));

    const result = await server.callTool('search_notes', { query: 'test', limit: 50 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to search notes');
  });
});

// ── read_note ────────────────────────────────────────────────────────

describe('read_note', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns full note content', async () => {
    const { server } = setup({ includeShared: true });
    mockRunJxa.mockResolvedValue({
      id: FAKE_NOTE_ID,
      name: 'My Note',
      folder: 'Notes',
      shared: false,
      body: '<h1>Title</h1><p>Content here</p>',
      plaintext: 'Title\nContent here',
      passwordProtected: false,
      creationDate: '2024-01-01',
      modificationDate: '2024-01-02',
    });

    const result = await server.callTool('read_note', { id: FAKE_NOTE_ID });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('UNTRUSTED');
    expect(result.content[0].text).toContain('Content here');
  });

  test('blocks shared note when includeShared=false', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue({
      id: FAKE_NOTE_ID,
      name: 'Shared Note',
      folder: 'Notes',
      shared: true,
      body: '<p>secret</p>',
      plaintext: 'secret',
      passwordProtected: false,
      creationDate: '2024-01-01',
      modificationDate: '2024-01-02',
    });

    const result = await server.callTool('read_note', { id: FAKE_NOTE_ID });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('shared');
  });

  // RFC 0001 Wave 1 — share-guard denials now emit typed errors.
  test('share-guard block produces permission_denied structuredContent', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue({
      id: FAKE_NOTE_ID,
      name: 'Shared Note',
      folder: 'Notes',
      shared: true,
      body: '<p>secret</p>',
      plaintext: 'secret',
      passwordProtected: false,
      creationDate: '2024-01-01',
      modificationDate: '2024-01-02',
    });

    const result = await server.callTool('read_note', { id: FAKE_NOTE_ID });

    expect(result.isError).toBe(true);
    expect(result.content[0].text.startsWith('[permission_denied] ')).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      category: 'permission_denied',
      retryable: false,
    });
  });

  test('returns error on JXA failure', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('Note not found'));

    const result = await server.callTool('read_note', { id: FAKE_NOTE_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to read note');
  });
});

// ── create_note ──────────────────────────────────────────────────────

describe('create_note', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('creates a note and returns id+name', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ id: 'new-id', name: 'New Note' });

    const result = await server.callTool('create_note', {
      body: '<h1>New Note</h1><p>Content</p>',
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('new-id');
    expect(parsed.name).toBe('New Note');
  });

  test('creates note in specified folder', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ id: 'new-id', name: 'Work Note' });

    const result = await server.callTool('create_note', {
      body: '<p>Work stuff</p>',
      folder: 'Work',
    });

    expect(result.isError).toBeUndefined();
    expect(mockRunJxa).toHaveBeenCalledTimes(1);
  });

  test('returns error on JXA failure', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('Permission denied'));

    const result = await server.callTool('create_note', {
      body: '<p>test</p>',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to create note');
  });
});

// ── update_note ──────────────────────────────────────────────────────

describe('update_note', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('updates note body', async () => {
    const { server } = setup({ includeShared: true });
    // First call: guardShared check skipped (includeShared=true)
    mockRunJxa.mockResolvedValue({ id: FAKE_NOTE_ID, name: 'Updated Note' });

    const result = await server.callTool('update_note', {
      id: FAKE_NOTE_ID,
      body: '<p>updated content</p>',
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe('Updated Note');
  });

  test('blocks update on shared note when includeShared=false', async () => {
    const { server } = setup({ includeShared: false });
    // guardShared JXA call returns shared=true
    mockRunJxa.mockResolvedValue({ shared: true });

    const result = await server.callTool('update_note', {
      id: FAKE_NOTE_ID,
      body: '<p>hacked</p>',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('shared');
  });
});

// ── delete_note ──────────────────────────────────────────────────────

describe('delete_note', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('deletes a note', async () => {
    const { server } = setup({ includeShared: true });
    mockRunJxa.mockResolvedValue({ deleted: true, name: 'Gone Note' });

    const result = await server.callTool('delete_note', { id: FAKE_NOTE_ID });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.deleted).toBe(true);
  });

  test('blocks deletion of shared note', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue({ shared: true });

    const result = await server.callTool('delete_note', { id: FAKE_NOTE_ID });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('shared');
  });
});

// ── list_folders ─────────────────────────────────────────────────────

describe('list_folders', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns folders with note counts', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue([
      { id: 'f1', name: 'Notes', account: 'iCloud', noteCount: 10, shared: false },
      { id: 'f2', name: 'Work', account: 'iCloud', noteCount: 5, shared: false },
    ]);

    const result = await server.callTool('list_folders', {});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Notes');
  });

  test('filters shared folders when includeShared=false', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue([
      { id: 'f1', name: 'Notes', account: 'iCloud', noteCount: 10, shared: false },
      { id: 'f2', name: 'Team Folder', account: 'iCloud', noteCount: 3, shared: true },
    ]);

    const result = await server.callTool('list_folders', {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Notes');
  });
});

// ── scan_notes ───────────────────────────────────────────────────────

describe('scan_notes', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns scan results with previews', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({
      total: 1,
      offset: 0,
      returned: 1,
      notes: [
        {
          id: 'id-1', name: 'Note', folder: 'Notes', shared: false,
          preview: 'Content preview...', charCount: 150,
          creationDate: '2024-01-01', modificationDate: '2024-01-02',
        },
      ],
    });

    const result = await server.callTool('scan_notes', { limit: 100, offset: 0, previewLength: 300 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('UNTRUSTED');
    expect(result.content[0].text).toContain('Content preview');
  });
});

// ── compare_notes ────────────────────────────────────────────────────

describe('compare_notes', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns compared notes', async () => {
    const { server } = setup({ includeShared: true });
    mockRunJxa.mockResolvedValue([
      { id: 'id-1', name: 'Note A', plaintext: 'AAA', folder: 'Notes', shared: false, charCount: 3, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
      { id: 'id-2', name: 'Note B', plaintext: 'BBB', folder: 'Notes', shared: false, charCount: 3, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
    ]);

    const result = await server.callTool('compare_notes', { ids: ['id-1', 'id-2'] });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('UNTRUSTED');
    expect(result.content[0].text).toContain('Note A');
    expect(result.content[0].text).toContain('Note B');
  });

  test('blocks comparison involving shared notes when includeShared=false', async () => {
    const { server } = setup({ includeShared: false });
    mockRunJxa.mockResolvedValue([
      { id: 'id-1', name: 'Note A', plaintext: 'AAA', folder: 'Notes', shared: false, charCount: 3, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
      { id: 'id-2', name: 'Shared B', plaintext: 'BBB', folder: 'Notes', shared: true, charCount: 3, creationDate: '2024-01-01', modificationDate: '2024-01-02' },
    ]);

    const result = await server.callTool('compare_notes', { ids: ['id-1', 'id-2'] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('shared');
  });
});

// ── Error handling (general) ─────────────────────────────────────────

describe('error handling', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('handles non-Error thrown values', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue('string error');

    const result = await server.callTool('list_notes', { limit: 200, offset: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('string error');
  });

  test('each tool wraps errors with its own context', async () => {
    const { server } = setup({ includeShared: true });
    mockRunJxa.mockRejectedValue(new Error('generic failure'));

    const listResult = await server.callTool('list_notes', { limit: 200, offset: 0 });
    expect(listResult.content[0].text).toContain('Failed to list notes');

    const readResult = await server.callTool('read_note', { id: FAKE_NOTE_ID });
    expect(readResult.content[0].text).toContain('Failed to read note');

    const createResult = await server.callTool('create_note', { body: '<p>x</p>' });
    expect(createResult.content[0].text).toContain('Failed to create note');

    const deleteResult = await server.callTool('delete_note', { id: FAKE_NOTE_ID });
    expect(deleteResult.content[0].text).toContain('Failed to delete note');

    const foldersResult = await server.callTool('list_folders', {});
    expect(foldersResult.content[0].text).toContain('Failed to list folders');
  });
});
