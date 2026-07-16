import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition, SkillResult, SkillStep, StepResult } from "./types.js";
import { toolRegistry, type ToolRegistry } from "../shared/tool-registry.js";
import { UNTRUSTED_END_MARKER, UNTRUSTED_START_MARKER, wrapUntrustedText } from "../shared/untrusted.js";

const SINGLE_TEMPLATE_RE = /^\{\{([^}]+)\}\}$/;
const EMBEDDED_TEMPLATE_RE = /\{\{([^}]+)\}\}/g;
const UNTRUSTED_CONTENT_META_KEY = "airmcp/untrustedContent";
const TAINTED_VALUE = Symbol("airmcp.untrustedTemplateValue");
const PRIMITIVE_TAINTED_VALUE = Symbol("airmcp.primitiveUntrustedTemplateValue");

/** Maximum iterations for a single loop step to prevent DoS. */
const MAX_LOOP_ITERATIONS = 1000;

interface TaintedValue {
  readonly [TAINTED_VALUE]: true;
}

interface PrimitiveTaintedValue extends TaintedValue {
  readonly [PRIMITIVE_TAINTED_VALUE]: true;
  readonly value: unknown;
}

function taintValue(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> | unknown[] = Array.isArray(value)
      ? [...value]
      : { ...(value as Record<string, unknown>) };
    Object.defineProperty(clone, TAINTED_VALUE, { value: true, enumerable: false });
    return clone;
  }
  return { [TAINTED_VALUE]: true, [PRIMITIVE_TAINTED_VALUE]: true, value };
}

function isTaintedValue(value: unknown): value is TaintedValue {
  return Boolean(value && typeof value === "object" && (value as Record<PropertyKey, unknown>)[TAINTED_VALUE] === true);
}

function isPrimitiveTaintedValue(value: unknown): value is PrimitiveTaintedValue {
  return isTaintedValue(value) && (value as unknown as Record<PropertyKey, unknown>)[PRIMITIVE_TAINTED_VALUE] === true;
}

function unwrapTaintedValue(value: unknown): unknown {
  return isPrimitiveTaintedValue(value) ? value.value : value;
}

function stringifyTemplateValue(value: unknown, jsonForObjects: boolean): string {
  if (value === undefined || value === null) return "";
  if (jsonForObjects && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isWrappedUntrustedText(value: string): boolean {
  return value.startsWith(`${UNTRUSTED_START_MARKER}\n`) && value.endsWith(`\n${UNTRUSTED_END_MARKER}`);
}

function materializeTemplateValue(value: unknown, wholeStringTemplate: boolean): unknown {
  if (!isTaintedValue(value)) return value;
  const raw = unwrapTaintedValue(value);
  if (typeof raw === "string") return isWrappedUntrustedText(raw) ? raw : wrapUntrustedText(raw);
  // A whole-template reference preserves the raw object/array (carrying its
  // non-enumerable taint marker) so it can still drive a downstream `loop:`
  // or a structured tool arg and be re-tainted per field access. Fencing is
  // applied where untrusted content actually reaches the model: a leaf
  // stringified into a prompt (the embedded branch below) or the skill's
  // final result (register.ts fences it via okUntrusted). Do NOT fence the
  // whole object here — it would turn arrays/objects into strings and break
  // loop sources (see tests/executor.test.js "untrusted array drives a later
  // prompt step").
  if (wholeStringTemplate) return raw;
  return wrapUntrustedText(stringifyTemplateValue(raw, true));
}

/**
 * Resolve `{{stepId.field.path}}` templates against collected step results.
 *
 * - If the entire string is a single `{{...}}`, returns the raw value (preserves type).
 * - Otherwise, replaces each `{{...}}` within the string with its stringified value.
 * - Recurses into plain objects and arrays.
 */
export function resolveTemplates(value: unknown, results: Map<string, unknown>): unknown {
  if (typeof value === "string") {
    // Entire string is a single template → return raw value
    const singleMatch = SINGLE_TEMPLATE_RE.exec(value);
    if (singleMatch) {
      return materializeTemplateValue(resolvePath(singleMatch[1]!.trim(), results), true);
    }
    // Mixed string with embedded templates
    return value.replace(EMBEDDED_TEMPLATE_RE, (_match, path: string) => {
      const resolved = resolvePath(path.trim(), results);
      return stringifyTemplateValue(materializeTemplateValue(resolved, false), false);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplates(v, results));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveTemplates(v, results);
    }
    return out;
  }
  return value;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function resolvePath(path: string, results: Map<string, unknown>): unknown {
  const parts = path.split(".");
  const stepId = parts[0]!;
  let current: unknown = results.get(stepId);
  let tainted = isTaintedValue(current);
  current = unwrapTaintedValue(current);
  for (let i = 1; i < parts.length && current != null; i++) {
    const key = parts[i]!;
    if (DANGEROUS_KEYS.has(key)) return undefined;
    if (isTaintedValue(current)) {
      tainted = true;
      current = unwrapTaintedValue(current);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (isTaintedValue(current)) {
    tainted = true;
    current = unwrapTaintedValue(current);
  }
  return tainted && current !== undefined ? taintValue(current) : current;
}

/* ------------------------------------------------------------------ */
/*  Lightweight expression evaluator for only_if / skip_if conditions */
/* ------------------------------------------------------------------ */

type Token = { kind: "value"; value: unknown } | { kind: "op"; op: string } | { kind: "paren"; paren: "(" | ")" };

/**
 * Tokenize a condition expression.
 *
 * Recognised token forms:
 *   {{path}}              → resolved template value
 *   123  /  3.14          → number literal
 *   "str" / 'str'         → string literal
 *   true / false / null   → keyword literal
 *   >= <= == != > < && || → operators
 *   ( )                   → grouping
 */
function tokenize(expr: string, results: Map<string, unknown>): Token[] {
  // Regex must be created here (not module‑level) because the `g` flag
  // carries mutable lastIndex state.
  const TOKEN_RE =
    /\{\{([^}]+)\}\}|(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(true|false|null)\b|(>=|<=|==|!=|&&|\|\||[><])|([()])/g;

  const tokens: Token[] = [];
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(expr)) !== null) {
    if (m[1] !== undefined) {
      // Template variable
      tokens.push({ kind: "value", value: unwrapTaintedValue(resolvePath(m[1].trim(), results)) });
    } else if (m[2] !== undefined) {
      // Number literal
      tokens.push({ kind: "value", value: parseFloat(m[2]) });
    } else if (m[3] !== undefined) {
      // Quoted string – strip surrounding quotes and unescape
      const raw = m[3].slice(1, -1).replace(/\\(.)/g, "$1");
      tokens.push({ kind: "value", value: raw });
    } else if (m[4] !== undefined) {
      // Keyword literal
      const kw = m[4];
      const val = kw === "true" ? true : kw === "false" ? false : null;
      tokens.push({ kind: "value", value: val });
    } else if (m[5] !== undefined) {
      // Operator
      tokens.push({ kind: "op", op: m[5] });
    } else if (m[6] !== undefined) {
      // Parenthesis
      tokens.push({ kind: "paren", paren: m[6] as "(" | ")" });
    }
  }

  return tokens;
}

function compare(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case "==":
      return left == right;
    case "!=":
      return left != right;
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

/**
 * Recursive‑descent parser with standard operator precedence:
 *
 *   parseOr        → parseAnd  ( '||' parseAnd  )*
 *   parseAnd       → parseComp ( '&&' parseComp )*
 *   parseComparison→ parsePrimary ( cmpOp parsePrimary )?
 *   parsePrimary   → value  |  '(' parseOr ')'
 */
const CMP_OPS = new Set(["==", "!=", ">", "<", ">=", "<="]);

function parseExpr(tokens: Token[]): unknown {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function advance(): Token {
    return tokens[pos++]!;
  }

  function peekOp(): string | undefined {
    const t = peek();
    return t?.kind === "op" ? t.op : undefined;
  }

  function parseOr(): unknown {
    let left = parseAnd();
    while (peekOp() === "||") {
      advance();
      left = left || parseAnd();
    }
    return left;
  }

  function parseAnd(): unknown {
    let left = parseComparison();
    while (peekOp() === "&&") {
      advance();
      left = left && parseComparison();
    }
    return left;
  }

  function parseComparison(): unknown {
    const left = parsePrimary();
    const op = peekOp();
    if (op && CMP_OPS.has(op)) {
      advance();
      return compare(left, op, parsePrimary());
    }
    return left;
  }

  function parsePrimary(): unknown {
    const t = peek();
    if (!t) return undefined;
    if (t.kind === "value") {
      advance();
      return t.value;
    }
    if (t.kind === "paren" && t.paren === "(") {
      advance();
      const val = parseOr();
      if (peek()?.kind === "paren") advance();
      return val;
    }
    advance();
    return undefined;
  }

  return parseOr();
}

/**
 * Evaluate a condition expression used in `only_if` / `skip_if`.
 *
 * - Resolves `{{…}}` template variables from prior step results.
 * - Supports comparison (`>`, `<`, `==`, `!=`, `>=`, `<=`) and
 *   logical (`&&`, `||`) operators with parentheses for grouping.
 * - A single resolved value falls back to a truthy check (backward compat).
 *
 * Returns a boolean.
 */
export function evaluateCondition(expr: string, results: Map<string, unknown>): boolean {
  const tokens = tokenize(expr, results);
  if (tokens.length === 0) return false;
  const first = tokens[0];
  if (tokens.length === 1 && first?.kind === "value") return !!first.value;
  return !!parseExpr(tokens);
}

/**
 * Look up a registered tool's handler and invoke it via the ToolRegistry.
 */
async function callTool(
  _server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
  registry: ToolRegistry,
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}> {
  return registry.callTool(toolName, args);
}

const DEFAULT_RETRY_BACKOFF_MS = 1000;
const MAX_RETRY_BACKOFF_MS = 60_000;

/**
 * Whether a non-thrown `{ isError: true }` tool response should be retried.
 * Only errors whose `structuredContent.error.retryable` flag is true (e.g.
 * `upstream_timeout`) are retryable. Terminal errors — HITL denials
 * (`permission_denied`) and `invalid_input` — carry `retryable: false`, so
 * they are NOT retried: retrying a HITL denial re-fires the approval dialog
 * for an action the user already rejected (approval fatigue), and retrying a
 * hard input error is pointless.
 */
function isRetryableErrorResponse(response: { structuredContent?: unknown; _meta?: Record<string, unknown> }): boolean {
  const sc = response.structuredContent;
  if (sc && typeof sc === "object" && "error" in sc) {
    const err = (sc as { error?: unknown }).error;
    if (err && typeof err === "object" && "retryable" in err) {
      return (err as { retryable?: unknown }).retryable === true;
    }
  }
  // outputSchema-bearing tools: the registry strips structuredContent from
  // isError results (a success schema would reject the typed error payload)
  // and preserves the error envelope in namespaced result metadata instead.
  // Without this branch, step retry silently stopped working for every
  // schema-bearing tool — retryable upstream timeouts included.
  const metaError = response._meta?.["airmcp/error"];
  if (metaError && typeof metaError === "object" && "retryable" in metaError) {
    return (metaError as { retryable?: unknown }).retryable === true;
  }
  return false;
}

/**
 * Invoke a tool with step-level retry semantics. The step is attempted up
 * to `1 + step.retry` times; each retry waits `base * 2^(attempt-1)` ms
 * with ±25% jitter, capped at MAX_RETRY_BACKOFF_MS.
 *
 * A non-thrown `{ isError: true }` response is retried ONLY when it is
 * retryable (see `isRetryableErrorResponse`); terminal errors (HITL denials,
 * invalid input) are returned immediately so a denied step is never
 * re-prompted. `parseToolResponse` still throws on the returned isError, so
 * the post-parse path stays as-is.
 *
 * Rate-limit denials (the tool-registry gate throws with "[rate_limited]")
 * are retryable because the rate limiter surfaces a retry-after hint and
 * the skill may legitimately outlive the window; those arrive via the throw
 * path below.
 */
async function callToolWithRetry(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
  step: SkillStep,
  registry: ToolRegistry,
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}> {
  const maxRetries = step.retry ?? 0;
  const baseBackoff = step.retry_backoff_ms ?? DEFAULT_RETRY_BACKOFF_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await callTool(server, toolName, args, registry);
      if (response.isError && attempt < maxRetries && isRetryableErrorResponse(response)) {
        // Tool reported a *retryable* error as a non-thrown response. Retry
        // with backoff; if we're out of retries, fall through and return the
        // isError response so the caller's existing error path fires.
        lastError = new Error(response.content[0]?.text ?? "Tool returned an error");
      } else {
        // Success, or a terminal (non-retryable) error such as a HITL denial /
        // invalid input — return immediately without re-invoking the tool.
        return response;
      }
    } catch (e) {
      lastError = e;
      if (attempt >= maxRetries) throw e;
    }
    const delay = Math.min(MAX_RETRY_BACKOFF_MS, baseBackoff * 2 ** attempt);
    const jitter = Math.floor(Math.random() * (delay * 0.25));
    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  }
  // Exhausted retries on a non-throwing isError — throw so parseToolResponse
  // / on_error pathways can handle it uniformly.
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const MAX_TOOL_RESPONSE_SIZE = 1_048_576; // 1MB

interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}

interface ParsedToolResponse {
  data: unknown;
  templateData: unknown;
}

function isUntrustedToolResponse(response: ToolResponse): boolean {
  return response._meta?.[UNTRUSTED_CONTENT_META_KEY] === true;
}

function parsedToolResponse(data: unknown, response: ToolResponse): ParsedToolResponse {
  return {
    data,
    templateData: isUntrustedToolResponse(response) ? taintValue(data) : data,
  };
}

function parseToolResponse(response: ToolResponse): ParsedToolResponse {
  if (response.isError) {
    throw new Error(response.content[0]?.text ?? "Tool returned an error");
  }
  // Prefer structuredContent (outputSchema-validated) when present — it
  // preserves types the text representation would flatten (e.g. nested
  // arrays, numbers stored as numbers not strings). Fall back to parsing
  // the text content only when no structured payload is provided.
  if (response.structuredContent !== undefined) {
    return parsedToolResponse(response.structuredContent, response);
  }
  const text = response.content[0]?.text;
  if (!text) return parsedToolResponse(null, response);
  if (text.length > MAX_TOOL_RESPONSE_SIZE) {
    return parsedToolResponse(
      text.slice(0, MAX_TOOL_RESPONSE_SIZE) + `... (truncated, ${text.length} chars total)`,
      response,
    );
  }
  try {
    return parsedToolResponse(JSON.parse(text), response);
  } catch {
    return parsedToolResponse(text, response);
  }
}

async function executeOneStep(
  server: McpServer,
  step: SkillStep,
  results: Map<string, unknown>,
  registry: ToolRegistry,
): Promise<{ stepResult: StepResult; data: unknown; templateData: unknown; untrusted: boolean }> {
  if (step.only_if && !evaluateCondition(step.only_if, results)) {
    return { stepResult: { id: step.id, status: "skipped" }, data: null, templateData: null, untrusted: false };
  }
  if (step.skip_if && evaluateCondition(step.skip_if, results)) {
    return { stepResult: { id: step.id, status: "skipped" }, data: null, templateData: null, untrusted: false };
  }

  if (step.loop) {
    const items = resolveTemplates(step.loop, results);
    if (!Array.isArray(items)) {
      return {
        stepResult: { id: step.id, status: "error", error: `loop expression did not resolve to an array` },
        data: null,
        templateData: null,
        untrusted: false,
      };
    }

    if (items.length > MAX_LOOP_ITERATIONS) {
      return {
        stepResult: {
          id: step.id,
          status: "error",
          error: `loop has ${items.length} items, exceeding max of ${MAX_LOOP_ITERATIONS}`,
        },
        data: null,
        templateData: null,
        untrusted: false,
      };
    }

    const loopResults: unknown[] = [];
    const loopTemplateResults: unknown[] = [];
    let loopHadFailure = false;
    // Use step-scoped loop variables to avoid clobbering shared results in parallel execution
    const loopScope = new Map(results);
    const taintedItems = isTaintedValue(items);
    for (let idx = 0; idx < items.length; idx++) {
      loopScope.set("_item", taintedItems ? taintValue(items[idx]) : items[idx]);
      loopScope.set("_index", idx);
      const resolvedArgs = (step.args ? resolveTemplates(step.args, loopScope) : {}) as Record<string, unknown>;
      try {
        const response = await callToolWithRetry(server, step.tool, resolvedArgs, step, registry);
        const parsed = parseToolResponse(response);
        loopResults.push(parsed.data);
        loopTemplateResults.push(parsed.templateData);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (step.on_error === "continue") {
          loopResults.push({ error });
          loopTemplateResults.push({ error });
          loopHadFailure = true;
          continue;
        }
        return {
          stepResult: { id: step.id, status: "error", error },
          data: loopResults,
          templateData: loopTemplateResults,
          untrusted: loopTemplateResults.some((d) => isTaintedValue(d)),
        };
      }
    }
    const loopUntrusted = loopTemplateResults.some((d) => isTaintedValue(d));
    if (loopHadFailure) {
      // Loop finished but at least one iteration failed under `continue`
      // — surface it as a partial success so downstream steps / callers see
      // the mix. `data` still contains all iteration results (including
      // `{ error }` entries) so templates can filter on success/failure.
      return {
        stepResult: { id: step.id, status: "ok", data: loopResults },
        data: loopResults,
        templateData: loopTemplateResults,
        untrusted: loopUntrusted,
      };
    }
    return {
      stepResult: { id: step.id, status: "ok", data: loopResults },
      data: loopResults,
      templateData: loopTemplateResults,
      untrusted: loopUntrusted,
    };
  }

  const resolvedArgs = (step.args ? resolveTemplates(step.args, results) : {}) as Record<string, unknown>;
  try {
    const response = await callToolWithRetry(server, step.tool, resolvedArgs, step, registry);
    const parsed = parseToolResponse(response);
    return {
      stepResult: { id: step.id, status: "ok", data: parsed.data },
      data: parsed.data,
      templateData: parsed.templateData,
      untrusted: isTaintedValue(parsed.templateData),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { stepResult: { id: step.id, status: "error", error }, data: null, templateData: null, untrusted: false };
  }
}

export async function executeSkill(
  server: McpServer,
  skill: SkillDefinition,
  inputs: Record<string, unknown> = {},
  registry: ToolRegistry = toolRegistry,
): Promise<SkillResult> {
  const results = new Map<string, unknown>();
  // Seed declared inputs into the template scope so steps can reference
  // them as `{{name}}` identically to prior-step results. Loader has
  // already verified no input name collides with a step id.
  for (const [name, value] of Object.entries(inputs)) {
    results.set(name, value);
  }
  const stepResults: StepResult[] = [];
  const failedSteps: string[] = [];
  let i = 0;
  // Set once any step surfaces untrusted external content; the registered
  // skill tool fences the final result when this is true (see register.ts).
  let sawUntrusted = false;

  // Build once: the terminal result shape when we need to bail early. Keeps
  // the two exit paths (hard abort / skip_remaining) in sync.
  const finalize = (success: boolean): SkillResult => {
    const res: SkillResult = { skill: skill.name, steps: stepResults, success };
    if (failedSteps.length > 0) {
      res.partial = !success || failedSteps.length > 0;
      res.failedSteps = [...failedSteps];
    }
    if (sawUntrusted) res.untrusted = true;
    return res;
  };

  while (i < skill.steps.length) {
    const step = skill.steps[i]!;

    if (step.parallel) {
      const group: typeof skill.steps = [];
      while (i < skill.steps.length && skill.steps[i]!.parallel) {
        group.push(skill.steps[i]!);
        i++;
      }

      const settled = await Promise.allSettled(group.map((s) => executeOneStep(server, s, results, registry)));

      let sawAbort = false;
      let sawSkipRemaining = false;
      for (let j = 0; j < group.length; j++) {
        const r = settled[j]!;
        const s = group[j]!;
        let stepResult: StepResult;
        let data: unknown;
        let templateData: unknown;
        if (r.status === "fulfilled") {
          stepResult = r.value.stepResult;
          data = r.value.data;
          templateData = r.value.templateData;
          sawUntrusted = sawUntrusted || r.value.untrusted;
        } else {
          const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
          stepResult = { id: s.id, status: "error", error };
          data = null;
          templateData = null;
        }
        if (stepResult.status === "error") {
          failedSteps.push(s.id);
          const policy = s.on_error ?? "abort";
          if (policy === "abort") sawAbort = true;
          else if (policy === "skip_remaining") sawSkipRemaining = true;
          // `continue`: expose `{ error }` to subsequent steps via templates.
          results.set(s.id, policy === "continue" ? { error: stepResult.error } : data);
        } else {
          results.set(s.id, templateData);
        }
        stepResults.push(stepResult);
      }

      if (sawAbort) return finalize(false);
      if (sawSkipRemaining) return finalize(false);
      continue;
    }

    const result = await executeOneStep(server, step, results, registry);
    stepResults.push(result.stepResult);
    sawUntrusted = sawUntrusted || result.untrusted;

    if (result.stepResult.status === "error") {
      failedSteps.push(step.id);
      const policy = step.on_error ?? "abort";
      if (policy === "continue") {
        // Make the error available to later steps via `{{stepId.error}}`.
        results.set(step.id, { error: result.stepResult.error });
        i++;
        continue;
      }
      // "abort" and "skip_remaining" both stop here; the difference is purely
      // semantic in the result (partial flag is identical either way).
      results.set(step.id, null);
      return finalize(false);
    }

    results.set(step.id, result.templateData);
    i++;
  }

  return finalize(true);
}
