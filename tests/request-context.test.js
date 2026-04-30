/**
 * request-context unit tests.
 *
 * AsyncLocalStorage is the foundation for the per-request OAuth claim
 * propagation that the tool-registry scope gate + per-tenant rate
 * limit rely on. These cases lock down the contract: claims live for
 * the duration of the runWithRequestContext callback, isolation works
 * across concurrent tasks, and async boundaries (await, setTimeout,
 * promise chains) preserve the store the same way Node guarantees.
 *
 * Integration with the gates (scope check, tenant key) is exercised in
 * tool-registry-scope-gate.test.js and rate-limit.test.js — this file
 * focuses on the AsyncLocalStorage primitives themselves.
 */
import { describe, test, expect } from '@jest/globals';

const { runWithRequestContext, getRequestContext, getOAuthClaims } = await import(
  '../dist/shared/request-context.js'
);

const baseClaims = (overrides = {}) => ({
  subject: 'user-1',
  scopes: ['mcp:read'],
  raw: { sub: 'user-1', scope: 'mcp:read' },
  ...overrides,
});

describe('request-context — outside the store', () => {
  test('getRequestContext returns undefined when no store is active', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  test('getOAuthClaims returns undefined when no store is active', () => {
    expect(getOAuthClaims()).toBeUndefined();
  });
});

describe('request-context — inside runWithRequestContext', () => {
  test('getRequestContext returns the supplied context', () => {
    const ctx = { oauth: baseClaims() };
    runWithRequestContext(ctx, () => {
      expect(getRequestContext()).toBe(ctx);
    });
  });

  test('getOAuthClaims returns the OAuth claims from the active context', () => {
    const claims = baseClaims({ subject: 'alice', scopes: ['mcp:read', 'mcp:destructive'] });
    runWithRequestContext({ oauth: claims }, () => {
      const got = getOAuthClaims();
      expect(got).toBe(claims);
      expect(got.subject).toBe('alice');
      expect(got.scopes).toEqual(['mcp:read', 'mcp:destructive']);
    });
  });

  test('getOAuthClaims returns undefined when context has no oauth field', () => {
    runWithRequestContext({}, () => {
      expect(getRequestContext()).toEqual({});
      expect(getOAuthClaims()).toBeUndefined();
    });
  });

  test('runWithRequestContext propagates the callback return value', () => {
    const result = runWithRequestContext({ oauth: baseClaims() }, () => 42);
    expect(result).toBe(42);
  });
});

describe('request-context — async boundaries', () => {
  test('claims persist through await of an async callback', async () => {
    const claims = baseClaims({ subject: 'await-user' });
    const subject = await runWithRequestContext({ oauth: claims }, async () => {
      // Yield control once to make sure AsyncLocalStorage carries us
      // back to the same store after the microtask boundary.
      await Promise.resolve();
      return getOAuthClaims()?.subject;
    });
    expect(subject).toBe('await-user');
  });

  test('claims persist across setTimeout boundaries', async () => {
    const claims = baseClaims({ subject: 'timer-user' });
    const got = await runWithRequestContext({ oauth: claims }, () => {
      return new Promise((resolve) => {
        setTimeout(() => resolve(getOAuthClaims()?.subject), 1);
      });
    });
    expect(got).toBe('timer-user');
  });

  test('store is cleared once the callback resolves', async () => {
    await runWithRequestContext({ oauth: baseClaims({ subject: 'inside' }) }, async () => {
      expect(getOAuthClaims()?.subject).toBe('inside');
    });
    // Outside the callback we're back on the bare task — no leakage.
    expect(getOAuthClaims()).toBeUndefined();
  });
});

describe('request-context — isolation', () => {
  test('concurrent runs see only their own claims', async () => {
    // Two concurrent async branches, each with its own subject. Both
    // await before reading so the scheduler is forced to interleave —
    // if the store leaked, getOAuthClaims would return the wrong one.
    const branch = (subject, holdMs) =>
      runWithRequestContext({ oauth: baseClaims({ subject }) }, async () => {
        await new Promise((r) => setTimeout(r, holdMs));
        return getOAuthClaims()?.subject;
      });

    const [a, b] = await Promise.all([branch('alice', 10), branch('bob', 1)]);
    expect(a).toBe('alice');
    expect(b).toBe('bob');
  });

  test('nested runWithRequestContext shadows the outer store, then restores', () => {
    const outer = baseClaims({ subject: 'outer' });
    const inner = baseClaims({ subject: 'inner' });

    runWithRequestContext({ oauth: outer }, () => {
      expect(getOAuthClaims()?.subject).toBe('outer');
      runWithRequestContext({ oauth: inner }, () => {
        expect(getOAuthClaims()?.subject).toBe('inner');
      });
      // After the nested run unwinds we see the outer store again.
      expect(getOAuthClaims()?.subject).toBe('outer');
    });
  });

  test('nested context with a different shape (no oauth) hides outer claims', () => {
    runWithRequestContext({ oauth: baseClaims() }, () => {
      expect(getOAuthClaims()).toBeDefined();
      runWithRequestContext({}, () => {
        // The nested store has no oauth field; helper must return
        // undefined so downstream gates short-circuit instead of
        // surfacing stale claims from the outer scope.
        expect(getOAuthClaims()).toBeUndefined();
      });
      expect(getOAuthClaims()).toBeDefined();
    });
  });
});

describe('request-context — claim shape', () => {
  test('raw payload is preserved verbatim', () => {
    const raw = { sub: 'user-1', scope: 'mcp:read', custom: 'meta', exp: 12345 };
    runWithRequestContext({ oauth: { subject: 'user-1', scopes: ['mcp:read'], raw } }, () => {
      expect(getOAuthClaims()?.raw).toBe(raw);
      expect(getOAuthClaims()?.raw.custom).toBe('meta');
      expect(getOAuthClaims()?.raw.exp).toBe(12345);
    });
  });

  test('empty scope arrays are returned unchanged', () => {
    runWithRequestContext({ oauth: baseClaims({ scopes: [] }) }, () => {
      expect(getOAuthClaims()?.scopes).toEqual([]);
    });
  });
});
