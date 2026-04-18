import { describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import { MemoryStore, deriveId } from '../dist/memory/store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Fresh store rooted in a per-test temp dir so we never touch ~/.cache/airmcp. */
async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'airmcp-memory-'));
  const path = join(dir, 'memory.json');
  return { store: new MemoryStore(path), dir, path };
}

const tmpDirsToClean = [];

afterAll(async () => {
  await Promise.all(
    tmpDirsToClean.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})),
  );
});

describe('MemoryStore', () => {
  let store;
  let dir;

  beforeEach(async () => {
    const s = await makeStore();
    store = s.store;
    dir = s.dir;
    tmpDirsToClean.push(dir);
  });

  test('deriveId returns stable "${kind}:${key}" form', () => {
    expect(deriveId('fact', 'favorite_editor')).toBe('fact:favorite_editor');
    expect(deriveId('entity', 'person:Ada')).toBe('entity:person:Ada');
  });

  test('put inserts a new entry with derived id and normalized tags', async () => {
    const entry = await store.put({
      kind: 'fact',
      key: 'editor',
      value: 'VSCode',
      tags: ['Tools', 'tools', ' Preferences '],
    });
    expect(entry.id).toBe('fact:editor');
    expect(entry.tags).toEqual(['preferences', 'tools']); // deduped + sorted
    expect(entry.createdAt).toBeDefined();
    expect(entry.updatedAt).toBeDefined();
  });

  test('put upserts when id already exists — keeps createdAt, bumps updatedAt', async () => {
    const first = await store.put({ kind: 'fact', key: 'editor', value: 'Vim' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.put({ kind: 'fact', key: 'editor', value: 'VSCode' });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
    expect(second.value).toBe('VSCode');
  });

  test('put honours ttl_ms and query skips expired entries', async () => {
    await store.put({ kind: 'fact', key: 'ephemeral', value: 'gone soon', ttlMs: 15 });
    await store.put({ kind: 'fact', key: 'durable', value: 'still here' });
    await new Promise((r) => setTimeout(r, 30));
    const rows = await store.query({});
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('durable');
    expect(keys).not.toContain('ephemeral');
  });

  test('query filters by kind, tag, and contains', async () => {
    await store.put({ kind: 'fact', key: 'editor', value: 'VSCode', tags: ['tools'] });
    await store.put({ kind: 'entity', key: 'person:Ada', value: 'mentor', tags: ['people'] });
    await store.put({ kind: 'episode', key: '2026-04-19_standup', value: 'discussed Q2 plan', tags: ['work'] });

    const facts = await store.query({ kind: 'fact' });
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('editor');

    const tagged = await store.query({ tags: ['people'] });
    expect(tagged).toHaveLength(1);
    expect(tagged[0].kind).toBe('entity');

    const containing = await store.query({ contains: 'Q2' });
    expect(containing).toHaveLength(1);
    expect(containing[0].kind).toBe('episode');
  });

  test('query limit and order (desc by default, asc on request)', async () => {
    await store.put({ kind: 'fact', key: 'a', value: 'one' });
    await new Promise((r) => setTimeout(r, 5));
    await store.put({ kind: 'fact', key: 'b', value: 'two' });
    await new Promise((r) => setTimeout(r, 5));
    await store.put({ kind: 'fact', key: 'c', value: 'three' });

    const desc = await store.query({ limit: 2 });
    expect(desc).toHaveLength(2);
    expect(desc[0].key).toBe('c');
    expect(desc[1].key).toBe('b');

    const asc = await store.query({ order: 'asc', limit: 2 });
    expect(asc[0].key).toBe('a');
  });

  test('forget by id removes a single entry', async () => {
    const entry = await store.put({ kind: 'fact', key: 'editor', value: 'VSCode' });
    const removed = await store.forget({ id: entry.id });
    expect(removed).toEqual([entry.id]);
    const rows = await store.query({});
    expect(rows).toHaveLength(0);
  });

  test('forget by tag removes all matching entries', async () => {
    await store.put({ kind: 'fact', key: 'editor', value: 'VSCode', tags: ['tools'] });
    await store.put({ kind: 'fact', key: 'shell', value: 'zsh', tags: ['tools'] });
    await store.put({ kind: 'entity', key: 'person:Ada', value: 'mentor', tags: ['people'] });
    const removed = await store.forget({ tag: 'tools' });
    expect(removed).toHaveLength(2);
    const rest = await store.query({});
    expect(rest).toHaveLength(1);
    expect(rest[0].kind).toBe('entity');
  });

  test('forget with zero or multiple selectors throws', async () => {
    await expect(store.forget({})).rejects.toThrow(/exactly one/i);
    await expect(store.forget({ id: 'x', key: 'y' })).rejects.toThrow(/exactly one/i);
  });

  test('stats reports counts by kind and sweeps expired rows', async () => {
    await store.put({ kind: 'fact', key: 'a', value: '1' });
    await store.put({ kind: 'fact', key: 'b', value: '2' });
    await store.put({ kind: 'entity', key: 'e', value: 'x' });
    await store.put({ kind: 'episode', key: 'ep', value: 'y', ttlMs: 10 });
    await new Promise((r) => setTimeout(r, 25));
    const s = await store.stats();
    expect(s.total).toBe(3);
    expect(s.byKind.fact).toBe(2);
    expect(s.byKind.entity).toBe(1);
    expect(s.byKind.episode).toBe(0);
    expect(s.expiredSwept).toBe(1);
    expect(typeof s.path).toBe('string');
  });

  test('entries round-trip through disk', async () => {
    await store.put({ kind: 'fact', key: 'editor', value: 'VSCode', tags: ['tools'] });
    // Force cache drop and re-read from disk.
    store.resetCacheForTests();
    const rows = await store.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('editor');
    expect(rows[0].tags).toEqual(['tools']);
  });
});
