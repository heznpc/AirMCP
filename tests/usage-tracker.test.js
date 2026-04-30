/**
 * UsageTracker unit tests.
 *
 * Each case isolates the singleton via _resetForTests + a tmp profile
 * path so disk persistence can be exercised without touching the user's
 * real ~/.airmcp/profile.json. The env var must be set BEFORE importing
 * the module — constants.ts evaluates PATHS at import time.
 */
import { describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRATCH = mkdtempSync(join(tmpdir(), 'airmcp-usage-'));
const PROFILE = join(SCRATCH, 'profile.json');
process.env.AIRMCP_USAGE_PROFILE_PATH = PROFILE;
process.env.NODE_ENV = 'test';

const { usageTracker } = await import('../dist/shared/usage-tracker.js');

beforeEach(() => {
  // Wipe disk + memory between cases so frequency / sequences start at 0.
  if (existsSync(PROFILE)) rmSync(PROFILE);
  usageTracker._resetForTests();
});

afterAll(() => {
  usageTracker.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('UsageTracker — record + getStats', () => {
  test('record increments frequency for the same tool', () => {
    usageTracker.record('tool_a');
    usageTracker.record('tool_a');
    usageTracker.record('tool_b');

    const stats = usageTracker.getStats();
    expect(stats.totalCalls).toBe(3);

    const a = stats.topTools.find((t) => t.tool === 'tool_a');
    const b = stats.topTools.find((t) => t.tool === 'tool_b');
    expect(a.count).toBe(2);
    expect(b.count).toBe(1);
  });

  test('getStats returns zeroed shape before any record', () => {
    const stats = usageTracker.getStats();
    expect(stats).toEqual({ totalCalls: 0, topTools: [], topSequences: [] });
  });

  test('topTools is sorted descending by count and capped at 10', () => {
    for (let i = 0; i < 15; i++) {
      const calls = i + 1;
      for (let j = 0; j < calls; j++) usageTracker.record(`tool_${i}`);
    }
    const stats = usageTracker.getStats();
    expect(stats.topTools).toHaveLength(10);
    // Most-called should win — tool_14 with 15 hits.
    expect(stats.topTools[0].tool).toBe('tool_14');
    expect(stats.topTools[0].count).toBe(15);
    // Sorted descending, no gaps.
    for (let i = 1; i < stats.topTools.length; i++) {
      expect(stats.topTools[i - 1].count).toBeGreaterThanOrEqual(stats.topTools[i].count);
    }
  });
});

describe('UsageTracker — sequences', () => {
  test('sequences capture A→B transitions', () => {
    usageTracker.record('a');
    usageTracker.record('b');
    usageTracker.record('a');
    usageTracker.record('b');

    const next = usageTracker.getNextTools('a');
    expect(next[0]).toEqual({ tool: 'b', count: 2 });
  });

  test('self-loops are ignored (record(x) twice creates no sequence)', () => {
    usageTracker.record('x');
    usageTracker.record('x');
    usageTracker.record('x');

    const stats = usageTracker.getStats();
    // Frequency still counts every call.
    expect(stats.topTools.find((t) => t.tool === 'x').count).toBe(3);
    // But there should be zero sequences — the lastTool === toolName guard
    // in record() must prevent x→x entries from polluting suggestions.
    expect(stats.topSequences).toHaveLength(0);
    expect(usageTracker.getNextTools('x')).toEqual([]);
  });

  test('getNextTools returns top K by count, default 5', () => {
    // Build six distinct successors of "anchor"; counts 1..6.
    const counts = [1, 2, 3, 4, 5, 6];
    for (const [i, c] of counts.entries()) {
      for (let j = 0; j < c; j++) {
        usageTracker.record('anchor');
        usageTracker.record(`succ_${i}`);
      }
    }
    const top = usageTracker.getNextTools('anchor');
    // Default topK = 5.
    expect(top).toHaveLength(5);
    // Sorted descending.
    expect(top[0]).toEqual({ tool: 'succ_5', count: 6 });
    expect(top[4]).toEqual({ tool: 'succ_1', count: 2 });

    // Custom topK is honored.
    expect(usageTracker.getNextTools('anchor', 2)).toHaveLength(2);
    expect(usageTracker.getNextTools('anchor', 100)).toHaveLength(6);
  });

  test('getNextTools returns empty array for unknown tool', () => {
    expect(usageTracker.getNextTools('never_called')).toEqual([]);
  });

  test('sequence pruning kicks in once the table grows past 1.2× cap', async () => {
    // MAX_SEQUENCE_ENTRIES = 500. The prune branch fires when
    // Object.keys(sequences).length > 600. We record 650 distinct
    // anchor_i → tail_i transitions so each pair adds exactly one new
    // sequence key, then assert the table was trimmed back to the cap.
    //
    // The internal sequences map isn't exposed; flush to disk and read
    // the JSON file (already pointed at a tmp path via env) to inspect
    // it. getStats().topSequences won't do — it always slices to 10
    // regardless of map size, so the assertion would pass even if no
    // pruning happened. (That's how this test got missed in PR #160.)
    for (let i = 0; i < 650; i++) {
      usageTracker.record(`anchor_${i}`);
      usageTracker.record(`tail_${i}`);
    }
    await usageTracker.flush();
    const onDisk = JSON.parse(readFileSync(PROFILE, 'utf-8'));
    const seqCount = Object.keys(onDisk.sequences).length;
    // Invariant: size is bounded by the 1.2× high-water trigger (600).
    // Prune fires the moment the table exceeds that threshold and trims
    // the bottom (least-used) keys down toward MAX_SEQUENCE_ENTRIES.
    // Across a 650-pair burst the size oscillates within [500, 600];
    // we don't pin a precise post-trim count because record-by-record
    // re-trigger ordering is sensitive to sort tie-breaks.
    expect(seqCount).toBeLessThanOrEqual(600);
    // …and well below the count we'd see with no pruning at all
    // (650 anchor→tail + 649 tail→next-anchor ≈ 1299 sequences).
    expect(seqCount).toBeLessThan(1000);

    // Spot-check: a heavily-reinforced key after pruning must survive a
    // subsequent prune cycle. Bump anchor_649 → tail_649 a few more
    // times so its count dominates the table tail; the next prune
    // pass keeps high-count keys.
    usageTracker.record('anchor_649');
    usageTracker.record('tail_649');
    usageTracker.record('anchor_649');
    usageTracker.record('tail_649');
    await usageTracker.flush();
    const afterBump = JSON.parse(readFileSync(PROFILE, 'utf-8'));
    expect(afterBump.sequences['anchor_649 → tail_649']).toBeGreaterThanOrEqual(3);
    // Sanity: the table is still bounded (no leak after additional
    // records).
    expect(Object.keys(afterBump.sequences).length).toBeLessThanOrEqual(600);
  });
});

describe('UsageTracker — flush + load roundtrip', () => {
  test('flush() writes JSON to disk; reload via reset+record merges', async () => {
    usageTracker.record('a');
    usageTracker.record('b');
    await usageTracker.flush();

    expect(existsSync(PROFILE)).toBe(true);
    const onDisk = JSON.parse(readFileSync(PROFILE, 'utf-8'));
    expect(onDisk.version).toBe(1);
    expect(onDisk.frequency.a).toBe(1);
    expect(onDisk.frequency.b).toBe(1);
    expect(typeof onDisk.updatedAt).toBe('string');

    // Reset + record triggers loadSync which merges the disk profile.
    // Wait for the async load to settle before asserting.
    usageTracker._resetForTests();
    usageTracker.record('a');
    await usageTracker.flush(); // awaits this.loaded internally

    const stats = usageTracker.getStats();
    // Disk had a:1, b:1. New session adds a:1 → expected a:2, b:1.
    expect(stats.topTools.find((t) => t.tool === 'a').count).toBe(2);
    expect(stats.topTools.find((t) => t.tool === 'b').count).toBe(1);
  });

  test('flush is a no-op when nothing has been recorded', async () => {
    await usageTracker.flush();
    expect(existsSync(PROFILE)).toBe(false);
  });

  test('flushSync is a no-op when nothing has been recorded', () => {
    usageTracker.flushSync();
    expect(existsSync(PROFILE)).toBe(false);
  });

  test('flushSync writes synchronously after at least one record', async () => {
    usageTracker.record('sync_tool');
    // Give the async load (kicked off by record) a tick to settle.
    // flushSync skips while loaded is in-flight — wait for it.
    await usageTracker.flush();
    usageTracker.record('sync_tool');
    usageTracker.flushSync();
    expect(existsSync(PROFILE)).toBe(true);
    const onDisk = JSON.parse(readFileSync(PROFILE, 'utf-8'));
    expect(onDisk.frequency.sync_tool).toBeGreaterThanOrEqual(1);
  });
});

describe('UsageTracker — corrupt profile', () => {
  test('record() recovers when the on-disk profile is malformed JSON', async () => {
    writeFileSync(PROFILE, '{ this is not valid json', 'utf-8');
    // record() kicks off loadSync which logs and swallows the parse
    // error. The in-memory profile must still work, so subsequent
    // record + getStats behave as if disk was empty.
    const errs = [];
    const orig = console.error;
    console.error = (...args) => errs.push(args.join(' '));
    try {
      usageTracker.record('post_corrupt');
      usageTracker.record('post_corrupt');
      // Wait for the async load to finish so the error is flushed.
      await usageTracker.flush();
    } finally {
      console.error = orig;
    }
    expect(usageTracker.getStats().topTools.find((t) => t.tool === 'post_corrupt').count).toBe(2);
    // The path must surface in the error so a real-world corrupt file
    // is identifiable from the log line alone.
    expect(errs.some((line) => line.includes('Corrupt usage profile') && line.includes(PROFILE))).toBe(true);
  });
});

describe('UsageTracker — hourly histogram', () => {
  test('hourly buckets are 24-wide and the current hour is the only one bumped', async () => {
    usageTracker.record('hourly_tool');
    usageTracker.record('hourly_tool');
    usageTracker.record('hourly_tool');
    await usageTracker.flush();

    const onDisk = JSON.parse(readFileSync(PROFILE, 'utf-8'));
    const hist = onDisk.hourly.hourly_tool;
    expect(hist).toHaveLength(24);
    // All three calls in the same wall-clock hour → exactly one bucket
    // holds the count, the other 23 stay at 0.
    expect(hist.reduce((a, b) => a + b, 0)).toBe(3);
    expect(hist.filter((n) => n > 0)).toHaveLength(1);
    const hour = new Date().getHours();
    expect(hist[hour]).toBe(3);
  });
});

describe('UsageTracker — _resetForTests guard', () => {
  test('throws when NODE_ENV is not test and AIRMCP_TEST_MODE is unset', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origTestMode = process.env.AIRMCP_TEST_MODE;
    process.env.NODE_ENV = 'production';
    delete process.env.AIRMCP_TEST_MODE;
    try {
      expect(() => usageTracker._resetForTests()).toThrow(/only callable when NODE_ENV=test/);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origTestMode !== undefined) process.env.AIRMCP_TEST_MODE = origTestMode;
    }
  });
});
