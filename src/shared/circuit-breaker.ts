/**
 * Per-host circuit breaker for outbound HTTP.
 *
 * Why this exists
 * ----------------
 * Outbound paths (`src/maps/api.ts`, future Google Workspace calls) wrap
 * `fetch()` with `AbortSignal.timeout(...)`. That bounds a single request,
 * but does not protect the *next* call from hitting the same timeout. If
 * the upstream is down, ten consecutive tool calls each wait the full
 * timeout before failing — bad UX, wasted resource handles, and (for HTTP
 * mode) it amplifies the apparent latency seen by clients.
 *
 * A circuit breaker short-circuits in the OPEN state: requests are rejected
 * synchronously with `BreakerOpenError` while the upstream is presumed dead.
 * After `openMs` elapses the breaker transitions to HALF_OPEN — exactly one
 * probe is allowed; success closes the breaker, failure re-opens it.
 *
 * Tunable via `performance.circuitBreakerThreshold` /
 * `performance.circuitBreakerOpenMs` in `~/.config/airmcp/config.json`.
 * Defaults (5 failures / 30s open) are conservative enough that a single
 * transient blip doesn't trip the breaker.
 *
 * Non-goals
 * ----------
 * - No global breaker — each host gets its own instance via `getBreaker(host)`.
 *   A flaky Nominatim must not silence Open-Meteo.
 * - No fallback execution. Callers handle `BreakerOpenError` by either
 *   returning a structured tool error or falling back to a different path.
 * - No retry inside the breaker. JXA-level retry sits in `src/shared/jxa.ts`;
 *   layering an HTTP-level retry under the breaker would re-trigger failures
 *   the breaker is trying to suppress.
 */

import { assertTestMode } from "./errors.js";
import { log } from "./logger.js";

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. Default: 5. */
  failureThreshold: number;
  /** Time the breaker stays open before allowing one probe. Default: 30_000ms. */
  openMs: number;
  /** Optional identifier for log lines (e.g. "open-meteo"). */
  name?: string;
}

export class BreakerOpenError extends Error {
  readonly code = "BREAKER_OPEN";
  constructor(name: string, retryInMs: number) {
    super(`Circuit breaker "${name}" is OPEN — upstream presumed down; retry in ~${retryInMs}ms`);
    this.name = "BreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly openMs: number;

  constructor(opts: BreakerOptions) {
    this.name = opts.name ?? "anonymous";
    this.failureThreshold = opts.failureThreshold;
    this.openMs = opts.openMs;
  }

  /** Run `fn` through the breaker. Throws `BreakerOpenError` when OPEN. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.openMs) {
        throw new BreakerOpenError(this.name, this.openMs - elapsed);
      }
      this.state = "half_open";
      log.info("circuit breaker probing (half-open)", { name: this.name });
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (e) {
      this.recordFailure();
      throw e;
    }
  }

  /** Test-only — read state without exposing setters. */
  getState(): BreakerState {
    return this.state;
  }

  /** Test-only — read consecutive-failure count. */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /** Test-only — reset to closed. */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  private recordSuccess(): void {
    if (this.state === "half_open") {
      log.info("circuit breaker closed after successful probe", { name: this.name });
    }
    this.state = "closed";
    this.consecutiveFailures = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === "half_open") {
      this.trip("probe-failed");
      return;
    }
    if (this.state === "closed" && this.consecutiveFailures >= this.failureThreshold) {
      this.trip("threshold-reached");
    }
  }

  private trip(reason: "probe-failed" | "threshold-reached"): void {
    this.state = "open";
    this.openedAt = Date.now();
    const event = reason === "probe-failed" ? "re-opened" : "tripped — opening";
    log.warn(`circuit breaker ${event}`, {
      name: this.name,
      reason,
      consecutiveFailures: this.consecutiveFailures,
      openMs: this.openMs,
    });
  }
}

// ── Per-host registry ─────────────────────────────────────────────────
//
// A global Map keyed by host name. **Contract:** `name` must be a
// compile-time constant (typically from `src/shared/constants.ts` →
// `BREAKER.*`). Do NOT derive it from request data — the registry has no
// eviction, so user-supplied names would grow memory monotonically.

const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(name: string, opts?: Partial<BreakerOptions>): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker({
      failureThreshold: opts?.failureThreshold ?? 5,
      openMs: opts?.openMs ?? 30_000,
      name,
    });
    breakers.set(name, b);
  }
  return b;
}

/** Test-only: reset every registered breaker to closed. */
export function _resetAllBreakersForTests(): void {
  assertTestMode("_resetAllBreakersForTests()");
  for (const b of breakers.values()) b.reset();
}
