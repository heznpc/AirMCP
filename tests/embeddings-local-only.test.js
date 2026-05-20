/**
 * Regression test for MEDIUM #11 in the 2026-05-13 audit:
 *
 *   "Embeddings depend on cloud (Gemini) or a Swift bridge. The Hybrid:
 *    on-device first, cloud fallback path silently calls Gemini on any
 *    Swift failure, no opt-in flag, no audit trail. A user who set
 *    GEMINI_API_KEY for one-time testing keeps sending their note
 *    titles + previews to Google whenever the Swift bridge throws."
 *
 * Fix is twofold:
 *   1. `AIRMCP_LOCAL_ONLY=true` hard-disables every cloud crossing:
 *      detectProvider downgrades hybrid/gemini → swift/none and a
 *      conflicting AIRMCP_EMBEDDING_PROVIDER=gemini is rejected loudly.
 *   2. When fallback is NOT disabled, every Swift→Gemini fallback emits
 *      an `__embedding_fallback` audit line so the trail is preserved
 *      even when the operator left cloud-fallback enabled.
 *
 * The two halves of the fix are tested independently.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Capture audit calls without touching disk. We mock the audit module
// BEFORE importing the embeddings module so the production code picks
// up the spy.
const auditCalls = [];
jest.unstable_mockModule('../dist/shared/audit.js', () => ({
  auditLog: (entry) => {
    auditCalls.push(entry);
  },
}));

// Control the Swift bridge presence and embed failures.
const swiftMock = {
  runSwift: jest.fn(),
  checkSwiftBridge: jest.fn(),
};
jest.unstable_mockModule('../dist/shared/swift.js', () => swiftMock);

const embeddings = await import('../dist/semantic/embeddings.js');

const savedEnv = {};
function setEnv(key, value) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  auditCalls.length = 0;
  swiftMock.runSwift.mockReset();
  swiftMock.checkSwiftBridge.mockReset();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

describe('detectProvider — LOCAL_ONLY semantics', () => {
  test('LOCAL_ONLY=true + GEMINI_API_KEY + swift available → swift (no hybrid)', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', 'true');
    setEnv('GEMINI_API_KEY', 'fake-key');
    setEnv('AIRMCP_EMBEDDING_PROVIDER', undefined);
    swiftMock.checkSwiftBridge.mockResolvedValue(null);
    await expect(embeddings.detectProvider()).resolves.toBe('swift');
  });

  test('LOCAL_ONLY=true + GEMINI_API_KEY + no swift → none (refuses to silently fall back to cloud)', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', 'true');
    setEnv('GEMINI_API_KEY', 'fake-key');
    setEnv('AIRMCP_EMBEDDING_PROVIDER', undefined);
    swiftMock.checkSwiftBridge.mockResolvedValue(new Error('swift bridge unavailable'));
    await expect(embeddings.detectProvider()).resolves.toBe('none');
  });

  test('LOCAL_ONLY=true overrides explicit AIRMCP_EMBEDDING_PROVIDER=gemini with a stderr warning', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', 'true');
    setEnv('GEMINI_API_KEY', 'fake-key');
    setEnv('AIRMCP_EMBEDDING_PROVIDER', 'gemini');
    swiftMock.checkSwiftBridge.mockResolvedValue(null);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const provider = await embeddings.detectProvider();
      expect(provider).toBe('swift'); // downgraded
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('AIRMCP_LOCAL_ONLY overrides AIRMCP_EMBEDDING_PROVIDER'),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  test('LOCAL_ONLY=true overrides explicit AIRMCP_EMBEDDING_PROVIDER=hybrid (same downgrade path)', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', 'true');
    setEnv('GEMINI_API_KEY', 'fake-key');
    setEnv('AIRMCP_EMBEDDING_PROVIDER', 'hybrid');
    swiftMock.checkSwiftBridge.mockResolvedValue(null);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(embeddings.detectProvider()).resolves.toBe('swift');
    } finally {
      errSpy.mockRestore();
    }
  });

  test('LOCAL_ONLY accepts "1" as well as "true"', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', '1');
    setEnv('GEMINI_API_KEY', 'fake-key');
    setEnv('AIRMCP_EMBEDDING_PROVIDER', undefined);
    swiftMock.checkSwiftBridge.mockResolvedValue(null);
    await expect(embeddings.detectProvider()).resolves.toBe('swift');
  });

  test('LOCAL_ONLY unset preserves existing hybrid behaviour (regression pin)', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', undefined);
    setEnv('GEMINI_API_KEY', 'fake-key');
    setEnv('AIRMCP_EMBEDDING_PROVIDER', undefined);
    swiftMock.checkSwiftBridge.mockResolvedValue(null);
    await expect(embeddings.detectProvider()).resolves.toBe('hybrid');
  });
});

describe('embedText hybrid — fallback audit + LOCAL_ONLY refusal', () => {
  test('hybrid + swift failure + LOCAL_ONLY unset → falls back to gemini AND emits __embedding_fallback audit', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', undefined);
    setEnv('GEMINI_API_KEY', 'fake-key');
    // First runSwift call is the swift embed → throws; the gemini path
    // is exercised via global fetch which we stub.
    swiftMock.runSwift.mockRejectedValue(new Error('swift bridge transient failure'));
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
    });
    try {
      const v = await embeddings.embedText('hello world', 'hybrid');
      expect(v).toEqual([0.1, 0.2, 0.3]);
      expect(fetchSpy).toHaveBeenCalled();
      // The audit emission is the whole point: if a future refactor
      // drops it, the user loses the visibility this fix introduced.
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].tool).toBe('__embedding_fallback');
      expect(auditCalls[0].args).toMatchObject({ from: 'swift', to: 'gemini' });
      expect(typeof auditCalls[0].args.reason).toBe('string');
      expect(auditCalls[0].args.reason.length).toBeLessThanOrEqual(200);
      expect(auditCalls[0].status).toBe('ok');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('hybrid + swift failure + LOCAL_ONLY=true → throws (no fallback, no audit)', async () => {
    setEnv('AIRMCP_LOCAL_ONLY', 'true');
    setEnv('GEMINI_API_KEY', 'fake-key');
    swiftMock.runSwift.mockRejectedValue(new Error('swift bridge transient failure'));
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: { values: [0.1] } }),
    });
    try {
      // Use a distinct text so the embedCache from the previous test
      // doesn't short-circuit this one (cache key includes the text).
      await expect(embeddings.embedText('different-text-local-only', 'hybrid')).rejects.toThrow(
        /swift bridge transient failure/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(auditCalls).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('getEmbeddingConfig — localOnly diagnostic surface', () => {
  test('reports localOnly: true when env is set', () => {
    setEnv('AIRMCP_LOCAL_ONLY', 'true');
    expect(embeddings.getEmbeddingConfig().localOnly).toBe(true);
  });

  test('reports localOnly: false by default', () => {
    setEnv('AIRMCP_LOCAL_ONLY', undefined);
    expect(embeddings.getEmbeddingConfig().localOnly).toBe(false);
  });
});
