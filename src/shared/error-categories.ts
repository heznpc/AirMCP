/**
 * Canonical error categories for AirMCP tool failures.
 *
 * Defined in RFC 0001 (docs/rfc/0001-error-categories.md).
 *
 * Goals:
 *   - Clients (LLM callers, orchestrators) can reason about *how* to respond to
 *     a failure (retry? escalate? ask user?) without text-matching error strings.
 *   - Server-side observability (audit.ts, telemetry.ts) can aggregate error
 *     rates per category.
 *
 * This module is **additive**. Existing tools that return `err()` / `toolError()`
 * with free-form prefixes keep working. Tools can migrate to the typed helpers
 * in `result.ts` (errNotFound / errInvalidInput / …) at their own pace.
 */

/** All error categories. Ordering follows RFC 0001 §2.1. */
export const ERROR_CATEGORIES = [
  "invalid_input",
  "not_found",
  "permission_denied",
  "hitl_timeout",
  "upstream_error",
  "upstream_timeout",
  "jxa_error",
  "swift_error",
  "rate_limited",
  "deprecated",
  "unsupported_os",
  "internal_error",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/**
 * Origin hints — where a failure physically came from. Useful for triage,
 * not part of the client contract.
 */
export type ErrorOrigin = "jxa" | "swift" | "http" | "hitl" | "filesystem" | "network" | "unknown";

/**
 * Machine-readable error payload returned alongside the human-readable message.
 *
 * Shape:
 *   category     — one of ERROR_CATEGORIES
 *   message      — human-readable, same text as the MCP response body
 *   retryable    — `true` iff naive retry (same input) has a reasonable chance of success
 *   retryAfterMs — suggested backoff for rate_limited / upstream_timeout
 *   hint         — one-line actionable suggestion for the caller
 *   cause        — free-form origin / upstream code for telemetry
 */
export interface ToolErrorPayload {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  hint?: string;
  cause?: {
    code?: string;
    origin?: ErrorOrigin;
  };
  /** Auto-attached correlation ID for cross-log tracing. Pairs with
   *  the same field on `audit.jsonl` entries — `grep <id>` joins
   *  the failed tool result, the audit row, and any HITL prompt. */
  correlationId?: string;
}

/**
 * Default retryable-by-category map. Used when the caller doesn't override.
 *
 * Design: conservative — we flag retryable=true only where a retry is
 * plausible *without* the caller changing its input. "Fix and retry" cases
 * (invalid_input, permission_denied) are retryable=false.
 */
export const CATEGORY_RETRYABLE: Readonly<Record<ErrorCategory, boolean>> = Object.freeze({
  invalid_input: false,
  not_found: false,
  permission_denied: false,
  hitl_timeout: false,
  upstream_error: false,
  upstream_timeout: true,
  jxa_error: false,
  swift_error: false,
  rate_limited: true,
  deprecated: false,
  unsupported_os: false,
  internal_error: false,
});

/**
 * Type guard — is `s` a known error category?
 *
 * Used at boundaries where the category arrives as a string (e.g. parsed from
 * an error message prefix, or from a config file).
 */
export function isErrorCategory(s: unknown): s is ErrorCategory {
  return typeof s === "string" && (ERROR_CATEGORIES as readonly string[]).includes(s);
}

/**
 * Extract a leading `[category]` prefix from a text message, if present.
 *
 * Existing AirMCP error messages follow the convention:
 *     "[category] human message"
 * (see `toolError` in result.ts). This helper lets downstream code recover
 * the category from the string without touching every tool.
 *
 * Returns `null` if no recognised category is present.
 */
export function parseCategoryPrefix(message: string): {
  category: ErrorCategory;
  rest: string;
} | null {
  const m = /^\[([a-z_]+)\]\s?(.*)$/s.exec(message);
  if (!m) return null;
  const maybe = m[1];
  if (!isErrorCategory(maybe)) return null;
  return { category: maybe, rest: m[2] ?? "" };
}
