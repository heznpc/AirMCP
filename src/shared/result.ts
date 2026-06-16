import { getToolLinks, withLinks } from "./tool-links.js";
import { usageTracker } from "./usage-tracker.js";
import { CATEGORY_RETRYABLE, type ErrorCategory, type ErrorOrigin, type ToolErrorPayload } from "./error-categories.js";
import { getCorrelationId } from "./request-context.js";
import { stringifyUntrusted, withUntrustedMeta } from "./untrusted.js";

/** Return a successful MCP tool response with JSON-formatted data. */
export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Return a successful MCP tool response with _links for tool graph navigation, personalized by usage patterns. */
export function okLinked(toolName: string, data: unknown) {
  const usageNext = usageTracker.getNextTools(toolName);
  return ok(withLinks(toolName, data, usageNext));
}

/**
 * Return a successful MCP tool response that contains external/untrusted content.
 * Wraps the payload with markers so LLMs can distinguish data from instructions.
 * Use this for any tool that returns user-generated or third-party content
 * (emails, notes, web pages, messages, calendar events, documents, etc.).
 */
export function okUntrusted(data: unknown) {
  return withUntrustedMeta({
    content: [
      {
        type: "text" as const,
        text: stringifyUntrusted(data),
      },
    ],
  });
}

/** Return a successful MCP tool response with untrusted markers and structured content. */
export function okUntrustedStructured(data: unknown) {
  return {
    ...okUntrusted(data),
    structuredContent: data,
  };
}

/** Return a successful MCP tool response with both text and structured content. */
export function okStructured(data: unknown) {
  return {
    ...ok(data),
    structuredContent: data,
  };
}

/**
 * Return a successful MCP tool response with _links and structured content.
 *
 * structuredContent carries only `data` (matching outputSchema).
 * _links are appended as a separate text content block so that
 * the primary JSON in both text and structuredContent stays consistent
 * and conforms to the declared outputSchema.
 */
export function okLinkedStructured(toolName: string, data: unknown) {
  const usageNext = usageTracker.getNextTools(toolName);
  const links = getToolLinks(toolName, usageNext);
  const base = { ...ok(data), structuredContent: data };
  if (links.length > 0) {
    base.content.push({
      type: "text" as const,
      text: JSON.stringify({ _links: links }),
    });
  }
  return base;
}

/**
 * Like okLinkedStructured, but the primary text block is wrapped with
 * untrusted-content markers. Use for read tools that return user-generated
 * data (calendar events, notes, reminders) where content may include
 * attacker-controlled text from external invitees / collaborators.
 */
export function okUntrustedLinkedStructured(toolName: string, data: unknown) {
  const usageNext = usageTracker.getNextTools(toolName);
  const links = getToolLinks(toolName, usageNext);
  const base = { ...okUntrusted(data), structuredContent: data };
  if (links.length > 0) {
    base.content.push({
      type: "text" as const,
      text: JSON.stringify({ _links: links }),
    });
  }
  return base;
}

/**
 * Attach `_meta["anthropic/maxResultSizeChars"]` to a tool result.
 *
 * Claude Code (and compatible harnesses) use this hint to avoid truncating
 * large MCP results. The hint is advisory — clients that don't recognise it
 * simply ignore the field.
 *
 * @param maxChars  Maximum result size the client should accept (cap: 500 000).
 */
export function withResultSizeHint<T extends { content: unknown[]; _meta?: Record<string, unknown> }>(
  result: T,
  maxChars: number,
): T {
  const capped = Math.min(Math.max(maxChars, 0), 500_000);
  return { ...result, _meta: { ...result._meta, "anthropic/maxResultSizeChars": capped } };
}

/** Return an MCP tool error response. */
export function err(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ─── RFC 0001: typed error helpers ────────────────────────────────────────────

export interface ToolErrorOptions {
  retryable?: boolean;
  retryAfterMs?: number;
  hint?: string;
  cause?: { code?: string; origin?: ErrorOrigin };
  /** Override the auto-attached correlation ID. Useful for tests; in
   *  production the active request-context value is picked up
   *  automatically. */
  correlationId?: string;
}

export function toolErr(category: ErrorCategory, message: string, opts: ToolErrorOptions = {}) {
  const retryable = opts.retryable ?? (opts.retryAfterMs !== undefined ? true : CATEGORY_RETRYABLE[category]);
  const correlationId = opts.correlationId ?? getCorrelationId();

  const payload: ToolErrorPayload = {
    category,
    message,
    retryable,
    ...(opts.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
    ...(opts.hint ? { hint: opts.hint } : {}),
    ...(opts.cause ? { cause: opts.cause } : {}),
    ...(correlationId ? { correlationId } : {}),
  };

  const lines = [`[${category}] ${message}`];
  if (opts.hint) lines.push(`Hint: ${opts.hint}`);
  if (correlationId) {
    // One-line trace breadcrumb so a user looking at a failed tool call
    // can grep the audit log directly: `grep <id> ~/.airmcp/audit.jsonl`.
    lines.push(`Trace: ${correlationId}`);
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: { error: payload },
    isError: true as const,
  };
}

export function errInvalidInput(message: string, opts?: ToolErrorOptions) {
  return toolErr("invalid_input", message, opts);
}

export function errNotFound(message: string, opts?: ToolErrorOptions) {
  return toolErr("not_found", message, opts);
}

/** Default hint added to permission_denied errors when the caller
 *  didn't supply a more specific one. Points the user at the macOS
 *  Privacy & Security pane, which is the canonical fix for the JXA /
 *  Automation / Accessibility / Screen Recording denials AirMCP hits.
 *  Empty on non-darwin (CI runners, Linux clones) — there's no
 *  equivalent settings pane to advertise. */
const DEFAULT_PERMISSION_HINT =
  process.platform === "darwin"
    ? "Open System Settings → Privacy & Security and grant the requested permission, then re-run the tool."
    : "";

export function errPermission(message: string, opts?: ToolErrorOptions) {
  // Caller-supplied hint wins. Fall through to the platform default
  // when the caller doesn't supply one.
  const hint = opts?.hint || DEFAULT_PERMISSION_HINT;
  return toolErr("permission_denied", message, { ...opts, hint });
}

export function errUpstream(message: string, opts?: ToolErrorOptions) {
  return toolErr("upstream_error", message, opts);
}

export function errJxa(message: string, opts?: ToolErrorOptions) {
  const cause = opts?.cause ?? {};
  return toolErr("jxa_error", message, {
    ...opts,
    cause: { origin: "jxa", ...cause },
  });
}

export function errSwift(message: string, opts?: ToolErrorOptions) {
  const cause = opts?.cause ?? {};
  return toolErr("swift_error", message, {
    ...opts,
    cause: { origin: "swift", ...cause },
  });
}

export function errDeprecated(message: string, opts?: ToolErrorOptions) {
  return toolErr("deprecated", message, opts);
}

export function errUnsupportedOS(message: string, opts?: ToolErrorOptions) {
  return toolErr("unsupported_os", message, opts);
}

/**
 * Catch-block one-liners that pair an `err*` category with the same
 * "Failed to <action>: <message>" prefix the legacy `toolError` used,
 * but with the right `cause.origin` baked in. Use these in tool
 * handlers to keep catch blocks to a single line:
 *
 *   } catch (e) {
 *     return errJxaFor("list reminders", e);
 *   }
 *
 * Each helper is a thin wrapper around its `err*` counterpart — the
 * full options object (`hint`, `retryable`, `retryAfterMs`) is still
 * available via the third arg when the catch needs to pass extras.
 */
function formatCauseMessage(action: string, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return `Failed to ${action}: ${raw}`;
}

export function errJxaFor(action: string, e: unknown, opts?: ToolErrorOptions) {
  return errJxa(formatCauseMessage(action, e), opts);
}

export function errSwiftFor(action: string, e: unknown, opts?: ToolErrorOptions) {
  return errSwift(formatCauseMessage(action, e), opts);
}

export function errUpstreamFor(action: string, e: unknown, opts?: ToolErrorOptions) {
  return errUpstream(formatCauseMessage(action, e), opts);
}

/**
 * Standardized catch-block helper for tool handlers. Classifies the error
 * automatically and delegates to {@link toolErr} so every legacy caller also
 * gets the RFC 0001 `structuredContent.error` payload for free.
 *
 * Wire format is unchanged: `content[0].text` is still `"[category] Failed to <action>: <msg>"`.
 *
 * Classification heuristic (order matters):
 *   1. `not found` in the message → `not_found`
 *   2. `permission` / `denied` / `not authorized` → `permission_denied`
 *   3. `timed out` / `timeout` → `upstream_timeout`
 *   4. `rate limit` / `too many requests` / HTTP 429 → `rate_limited`
 *   5. anything else → `internal_error`
 *
 * SECURITY NOTE: the classification is a *convenience hint* for clients
 * and UX, **not** a security boundary. A misclassified error never hides
 * information — the full (PII-scrubbed) message is still included in both
 * `content[0].text` and `structuredContent.error.message`. Do not gate
 * access-control or retry decisions on the category alone; treat it as
 * advisory and fall back to the message text when the distinction matters.
 */
export function toolError(action: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();

  let category: ErrorCategory = "internal_error";
  if (lower.includes("not found")) {
    category = "not_found";
  } else if (
    lower.includes("not authorized") ||
    lower.includes("permission denied") ||
    lower.includes("permission_denied")
  ) {
    category = "permission_denied";
  } else if (lower.includes("timed out") || lower.includes("timeout")) {
    category = "upstream_timeout";
  } else if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes(" 429")) {
    category = "rate_limited";
  }

  return toolErr(category, `Failed to ${action}: ${msg}`);
}
