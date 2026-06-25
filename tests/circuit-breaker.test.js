/**
 * Circuit breaker — state machine contract tests.
 *
 * Per CLAUDE.md design principle 3 ("Tests assert handler behavior, not
 * registration metadata"), each test exercises the real state transitions:
 * pump real failures through `execute()` and observe the public state +
 * the BreakerOpenError side channel. No mocking of internal counters.
 *
 * Covered transitions:
 *   1. CLOSED  → stays CLOSED on success
 *   2. CLOSED  → stays CLOSED below failureThreshold
 *   3. CLOSED  → OPEN on failureThreshold consecutive failures
 *   4. OPEN    → rejects with BreakerOpenError before openMs elapses
 *   5. OPEN    → HALF_OPEN on first execute() after openMs
 *   6. HALF_OPEN → CLOSED on successful probe (counter resets)
 *   7. HALF_OPEN → OPEN on failed probe
 *   8. CLOSED  → success after failures resets the counter
 *   9. getBreaker registry — same name returns the same instance
 */

import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";

const ORIG_TEST_MODE = process.env.AIRMCP_TEST_MODE;
process.env.AIRMCP_TEST_MODE = "1";
const { CircuitBreaker, BreakerOpenError, getBreaker, _resetAllBreakersForTests } = await import(
  "../dist/shared/circuit-breaker.js"
);

beforeEach(() => {
  _resetAllBreakersForTests();
});

afterEach(() => {
  if (ORIG_TEST_MODE === undefined) delete process.env.AIRMCP_TEST_MODE;
  else process.env.AIRMCP_TEST_MODE = ORIG_TEST_MODE;
});

// Deterministic clock seam — replaces real setTimeout waits so the
// open->half_open eligibility never races under CI load.
function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe("CircuitBreaker", () => {
  test("CLOSED stays CLOSED on success", async () => {
    const b = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, name: "t" });
    const r = await b.execute(async () => "ok");
    expect(r).toBe("ok");
    expect(b.getState()).toBe("closed");
    expect(b.getFailureCount()).toBe(0);
  });

  test("CLOSED stays CLOSED below failureThreshold", async () => {
    const b = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, name: "t" });
    for (let i = 0; i < 2; i++) {
      await expect(b.execute(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }
    expect(b.getState()).toBe("closed");
    expect(b.getFailureCount()).toBe(2);
  });

  test("CLOSED → OPEN on failureThreshold consecutive failures", async () => {
    const b = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, name: "t" });
    for (let i = 0; i < 3; i++) {
      await expect(b.execute(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }
    expect(b.getState()).toBe("open");
  });

  test("OPEN rejects with BreakerOpenError before openMs elapses", async () => {
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 5_000, name: "t" });
    await expect(b.execute(async () => { throw new Error("trip"); })).rejects.toThrow("trip");
    expect(b.getState()).toBe("open");

    // Next execute() should short-circuit synchronously — the underlying fn
    // must NOT run.
    let called = 0;
    await expect(
      b.execute(async () => {
        called++;
        return "should-not-reach";
      }),
    ).rejects.toBeInstanceOf(BreakerOpenError);
    expect(called).toBe(0);
  });

  test("OPEN → HALF_OPEN → CLOSED on successful probe", async () => {
    const c = clock();
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 10, name: "t", now: c.now });
    await expect(b.execute(async () => { throw new Error("trip"); })).rejects.toThrow("trip");
    expect(b.getState()).toBe("open");

    // Advance past openMs deterministically.
    c.advance(20);

    // First post-openMs call: probe runs, succeeds → state should close.
    const r = await b.execute(async () => "probe-ok");
    expect(r).toBe("probe-ok");
    expect(b.getState()).toBe("closed");
    expect(b.getFailureCount()).toBe(0);
  });

  test("OPEN → HALF_OPEN → OPEN on failed probe", async () => {
    const c = clock();
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 10, name: "t", now: c.now });
    await expect(b.execute(async () => { throw new Error("trip"); })).rejects.toThrow("trip");
    expect(b.getState()).toBe("open");

    c.advance(20);

    // Probe fails — back to OPEN immediately.
    await expect(b.execute(async () => { throw new Error("probe-fail"); })).rejects.toThrow("probe-fail");
    expect(b.getState()).toBe("open");

    // And subsequent calls again short-circuit.
    await expect(
      b.execute(async () => "never"),
    ).rejects.toBeInstanceOf(BreakerOpenError);
  });

  test("CLOSED — success resets the failure counter", async () => {
    const b = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, name: "t" });
    await expect(b.execute(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(b.execute(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(b.getFailureCount()).toBe(2);

    await b.execute(async () => "recover");
    expect(b.getFailureCount()).toBe(0);
    expect(b.getState()).toBe("closed");

    // Now we should need a fresh 3 failures to trip.
    await expect(b.execute(async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(b.execute(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(b.getState()).toBe("closed");
  });

  test("HALF_OPEN admits exactly one in-flight probe (concurrent callers)", async () => {
    // Regression for the 2nd-pass audit (2026-05-21) — prior implementation
    // let two concurrent callers both transition to HALF_OPEN and both run
    // their fn() in parallel, violating the single-probe contract.
    const c = clock();
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 10, name: "race", now: c.now });
    await expect(b.execute(async () => { throw new Error("trip"); })).rejects.toThrow("trip");
    expect(b.getState()).toBe("open");
    c.advance(20);

    let probeCalls = 0;
    const slowProbe = async () => {
      probeCalls++;
      await new Promise((r) => setTimeout(r, 50));
      return "probe-ok";
    };
    // Both calls land while the breaker is OPEN-past-deadline. Exactly one
    // should claim the probe slot; the other must reject immediately with
    // BreakerOpenError(retryInMs=0).
    const [r1, r2] = await Promise.all([
      b.execute(slowProbe).catch((e) => e),
      b.execute(slowProbe).catch((e) => e),
    ]);
    expect(probeCalls).toBe(1);
    const successes = [r1, r2].filter((r) => r === "probe-ok").length;
    const rejections = [r1, r2].filter((r) => r instanceof BreakerOpenError).length;
    expect(successes).toBe(1);
    expect(rejections).toBe(1);
    // After a successful probe the breaker should be closed and the probe
    // slot released — a fresh call must go through.
    expect(b.getState()).toBe("closed");
    await b.execute(async () => "follow-up");
  });

  test("HALF_OPEN releases the probe slot after a failed probe", async () => {
    // Companion to the race-probe test: a *failed* probe must also release
    // the in-flight flag (it transitions back to OPEN, so subsequent
    // callers get a normal BreakerOpenError with retryInMs > 0, not an
    // immediate-retry response based on a stuck flag).
    const c = clock();
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 10, name: "race-fail", now: c.now });
    await expect(b.execute(async () => { throw new Error("trip"); })).rejects.toThrow("trip");
    c.advance(20);

    await expect(b.execute(async () => { throw new Error("probe-fail"); })).rejects.toThrow("probe-fail");
    expect(b.getState()).toBe("open");
    // Subsequent caller during the new OPEN window must see a retryInMs > 0,
    // proving the probe slot did not leak the half_open lock.
    try {
      await b.execute(async () => "x");
      throw new Error("expected BreakerOpenError");
    } catch (e) {
      expect(e).toBeInstanceOf(BreakerOpenError);
      expect(e.message).toMatch(/retry in ~\d+ms/);
      expect(e.message).not.toMatch(/retry in ~0ms/);
    }
  });

  test("BreakerOpenError carries the retry-in-ms message", async () => {
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 5_000, name: "open-meteo" });
    await expect(b.execute(async () => { throw new Error("trip"); })).rejects.toThrow("trip");
    try {
      await b.execute(async () => "x");
      throw new Error("expected BreakerOpenError");
    } catch (e) {
      expect(e).toBeInstanceOf(BreakerOpenError);
      expect(e.message).toContain("open-meteo");
      expect(e.message).toMatch(/retry in ~\d+ms/);
      expect(e.code).toBe("BREAKER_OPEN");
    }
  });

  test("getBreaker registry returns the same instance for the same name", () => {
    const a = getBreaker("nominatim");
    const b = getBreaker("nominatim");
    expect(a).toBe(b);
    const c = getBreaker("open-meteo");
    expect(c).not.toBe(a);
  });

  test("getBreaker honours custom opts only on first creation", () => {
    const a = getBreaker("custom-host", { failureThreshold: 2, openMs: 50 });
    // Subsequent call with different opts must return the SAME instance —
    // we don't re-create, otherwise registry-keyed state is meaningless.
    const b = getBreaker("custom-host", { failureThreshold: 99, openMs: 99_999 });
    expect(a).toBe(b);
  });

  test("_resetAllBreakersForTests guards against production accidents", () => {
    // Switch out of test mode and verify the guard fires.
    const orig = process.env.AIRMCP_TEST_MODE;
    delete process.env.AIRMCP_TEST_MODE;
    const origNode = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      // assertTestMode's canonical message; same gate used by audit / tool-registry.
      expect(() => _resetAllBreakersForTests()).toThrow(/NODE_ENV=test or AIRMCP_TEST_MODE=1/);
    } finally {
      if (orig !== undefined) process.env.AIRMCP_TEST_MODE = orig;
      if (origNode !== undefined) process.env.NODE_ENV = origNode;
    }
  });
});
