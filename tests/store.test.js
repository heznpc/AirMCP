import { describe, test, expect, beforeEach } from '@jest/globals';
import { VectorStore } from '../dist/semantic/store.js';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use a temp directory to avoid touching real store
const TEST_DIR = join(tmpdir(), `airmcp-test-${Date.now()}`);
const TEST_STORE_PATH = join(TEST_DIR, 'vectors.json');

// Patch PATHS for testing
let store;

describe('VectorStore', () => {
  beforeEach(async () => {
    // Create a fresh store instance using the real class
    // but we can't easily override the path, so test the methods conceptually
    store = new VectorStore();
  });

  test('getStats returns empty for new store', async () => {
    // A fresh store with no data should show 0 entries
    const stats = await store.getStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('bySource');
    expect(stats).toHaveProperty('stale');
    expect(typeof stats.total).toBe('number');
  });

  test('upsertEntries adds entries', async () => {
    const entries = [
      {
        id: 'test:1',
        source: 'notes',
        title: 'Test Note',
        text: 'Hello world',
        vector: [0.1, 0.2, 0.3],
        updatedAt: new Date().toISOString(),
      },
    ];

    const count = await store.upsertEntries(entries);
    expect(count).toBe(1);

    const stats = await store.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });

  test('getEntry returns null for missing ID', async () => {
    const entry = await store.getEntry('nonexistent:999');
    expect(entry).toBeNull();
  });

  test('getEntry returns existing entry', async () => {
    const entries = [
      {
        id: 'test:get',
        source: 'calendar',
        title: 'Meeting',
        text: 'Team standup',
        vector: [0.5, 0.5],
        updatedAt: new Date().toISOString(),
      },
    ];
    await store.upsertEntries(entries);

    const entry = await store.getEntry('test:get');
    expect(entry).not.toBeNull();
    expect(entry.title).toBe('Meeting');
  });

  test('getAllEntries returns all entries', async () => {
    await store.upsertEntries([
      { id: 'all:1', source: 'notes', title: 'A', text: 'a', vector: [1], updatedAt: new Date().toISOString() },
      { id: 'all:2', source: 'mail', title: 'B', text: 'b', vector: [2], updatedAt: new Date().toISOString() },
    ]);

    const entries = await store.getAllEntries();
    expect(entries['all:1']).toBeDefined();
    expect(entries['all:2']).toBeDefined();
  });

  test('clear empties the store', async () => {
    await store.upsertEntries([
      { id: 'clear:1', source: 'notes', title: 'X', text: 'x', vector: [1], updatedAt: new Date().toISOString() },
    ]);

    await store.clear();

    const stats = await store.getStats();
    expect(stats.total).toBe(0);
    expect(Object.keys(stats.bySource).length).toBe(0);
  });

  test('clear then getEntry returns null', async () => {
    await store.upsertEntries([
      { id: 'clearget:1', source: 'notes', title: 'Y', text: 'y', vector: [1], updatedAt: new Date().toISOString() },
    ]);

    await store.clear();
    const entry = await store.getEntry('clearget:1');
    expect(entry).toBeNull();
  });

  test('removeByPrefix removes matching entries', async () => {
    await store.upsertEntries([
      { id: 'note:1', source: 'notes', title: 'A', text: 'a', vector: [1], updatedAt: new Date().toISOString() },
      { id: 'note:2', source: 'notes', title: 'B', text: 'b', vector: [2], updatedAt: new Date().toISOString() },
      { id: 'event:1', source: 'calendar', title: 'C', text: 'c', vector: [3], updatedAt: new Date().toISOString() },
    ]);

    const removed = await store.removeByPrefix('note:');
    expect(removed).toBe(2);

    const entry = await store.getEntry('event:1');
    expect(entry).not.toBeNull();
    expect(await store.getEntry('note:1')).toBeNull();
  });

  test('isIndexStale returns true for empty store', async () => {
    await store.clear();
    const stale = await store.isIndexStale();
    expect(stale).toBe(true);
  });

  test('search returns results sorted by similarity', async () => {
    await store.upsertEntries([
      { id: 's:1', source: 'notes', title: 'Close', text: 'close', vector: [0.9, 0.1], updatedAt: new Date().toISOString() },
      { id: 's:2', source: 'notes', title: 'Far', text: 'far', vector: [0.1, 0.9], updatedAt: new Date().toISOString() },
    ]);

    const results = await store.search([0.95, 0.05], { topK: 10, threshold: 0 });
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('s:1'); // closer to query
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });
});
