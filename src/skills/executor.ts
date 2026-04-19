import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition, SkillResult, SkillStep, StepResult } from "./types.js";
import { toolRegistry } from "../shared/tool-registry.js";

const SINGLE_TEMPLATE_RE = /^\{\{([^}]+)\}\}$/;
const EMBEDDED_TEMPLATE_RE = /\{\{([^}]+)\}\}/g;

/** Maximum iterations for a single loop step to prevent DoS. */
const MAX_LOOP_ITERATIONS = 1000;

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
      return resolvePath(singleMatch[1]!.trim(), results);
    }
    // Mixed string with embedded templates
    return value.replace(EMBEDDED_TEMPLATE_RE, (_match, path: string) => {
      const resolved = resolvePath(path.trim(), results);
      return resolved === undefined || resolved === null ? "" : String(resolved);
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
  for (let i = 1; i < parts.length && current != null; i++) {
    const key = parts[i]!;
    if (DANGEROUS_KEYS.has(key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
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
      tokens.push({ kind: "value", value: resolvePath(m[1].trim(), results) });
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
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}> {
  return toolRegistry.callTool(toolName, args);
}

const DEFAULT_RETRY_BACKOFF_MS = 1000;
const MAX_RETRY_BACKOFF_MS = 60_000;

/**
 * Invoke a tool with step-level retry semantics. The step is attempted up
 * to `1 + step.retry` times; each retry waits `base * 2^(attempt-1)` ms
 * with ±25% jitter, capped at MAX_RETRY_BACKOFF_MS.
 *
 * `isError` responses are treated as failures (same as thrown errors),
 * so a tool that returns `{ isError: true }` gets the same retry treatment
 * as one that throws. `parseToolResponse` still throws on isError, so the
 * retry decision lives here and the post-parse path stays as-is.
 *
 * Rate-limit denials (the tool-registry gate throws with "[rate_limited]")
 * are retryable because the rate limiter surfaces a retry-after hint and
 * the skill may legitimately outlive the window.
 */
async function callToolWithRetry(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
  step: SkillStep,
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}> {
  const maxRetries = step.retry ?? 0;
  const baseBackoff = step.retry_backoff_ms ?? DEFAULT_RETRY_BACKOFF_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await callTool(server, toolName, args);
      if (response.isError && attempt < maxRetries) {
        // Tool reported an error as a non-thrown response. Retry with
        // backoff; if we're out of retries, fall through and return the
        // isError response so the caller's existing error path fires.
        lastError = new Error(response.content[0]?.text ?? "Tool returned an error");
      } else {
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

function parseToolResponse(response: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}): unknown {
  if (response.isError) {
    throw new Error(response.content[0]?.text ?? "Tool returned an error");
  }
  // Prefer structuredContent (outputSchema-validated) when present — it
  // preserves types the text representation would flatten (e.g. nested
  // arrays, numbers stored as numbers not strings). Fall back to parsing
  // the text content only when no structured payload is provided.
  if (response.structuredContent !== undefined) {
    return response.structuredContent;
  }
  const text = response.content[0]?.text;
  if (!text) return null;
  if (text.length > MAX_TOOL_RESPONSE_SIZE) {
    return text.slice(0, MAX_TOOL_RESPONSE_SIZE) + `... (truncated, ${text.length} chars total)`;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function executeOneStep(
  server: McpServer,
  step: SkillStep,
  results: Map<string, unknown>,
): Promise<{ stepResult: StepResult; data: unknown }> {
  if (step.only_if && !evaluateCondition(step.only_if, results)) {
    return { stepResult: { id: step.id, status: "skipped" }, data: null };
  }
  if (step.skip_if && evaluateCondition(step.skip_if, results)) {
    return { stepResult: { id: step.id, status: "skipped" }, data: null };
  }

  if (step.loop) {
    const items = resolveTemplates(step.loop, results);
    if (!Array.isArray(items)) {
      return {
        stepResult: { id: step.id, status: "error", error: `loop expression did not resolve to an array` },
        data: null,
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
      };
    }

    const loopResults: unknown[] = [];
    let loopHadFailure = false;
    // Use step-scoped loop variables to avoid clobbering shared results in parallel execution
    const loopScope = new Map(results);
    for (let idx = 0; idx < items.length; idx++) {
      loopScope.set("_item", items[idx]);
      loopScope.set("_index", idx);
      const resolvedArgs = (step.args ? resolveTemplates(step.args, loopScope) : {}) as Record<string, unknown>;
      try {
        const response = await callToolWithRetry(server, step.tool, resolvedArgs, step);
        loopResults.push(parseToolResponse(response));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (step.on_error === "continue") {
          loopResults.push({ error });
          loopHadFailure = true;
          continue;
        }
        return {
          stepResult: { id: step.id, status: "error", error },
          data: loopResults,
        };
      }
    }
    if (loopHadFailure) {
      // Loop finished but at least one iteration failed under `continue`
      // — surface it as a partial success so downstream steps / callers see
      // the mix. `data` still contains all iteration results (including
      // `{ error }` entries) so templates can filter on success/failure.
      return { stepResult: { id: step.id, status: "ok", data: loopResults }, data: loopResults };
    }
    return { stepResult: { id: step.id, status: "ok", data: loopResults }, data: loopResults };
  }

  const resolvedArgs = (step.args ? resolveTemplates(step.args, results) : {}) as Record<string, unknown>;
  try {
    const response = await callToolWithRetry(server, step.tool, resolvedArgs, step);
    const data = parseToolResponse(response);
    return { stepResult: { id: step.id, status: "ok", data }, data };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { stepResult: { id: step.id, status: "error", error }, data: null };
  }
}

export async function executeSkill(server: McpServer, skill: SkillDefinition): Promise<SkillResult> {
  const results = new Map<string, unknown>();
  const stepResults: StepResult[] = [];
  const failedSteps: string[] = [];
  let i = 0;

  // Build once: the terminal result shape when we need to bail early. Keeps
  // the two exit paths (hard abort / skip_remaining) in sync.
  const finalize = (success: boolean): SkillResult => {
    const res: SkillResult = { skill: skill.name, steps: stepResults, success };
    if (failedSteps.length > 0) {
      res.partial = !success || failedSteps.length > 0;
      res.failedSteps = [...failedSteps];
    }
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

      const settled = await Promise.allSettled(group.map((s) => executeOneStep(server, s, results)));

      let sawAbort = false;
      let sawSkipRemaining = false;
      for (let j = 0; j < group.length; j++) {
        const r = settled[j]!;
        const s = group[j]!;
        let stepResult: StepResult;
        let data: unknown;
        if (r.status === "fulfilled") {
          stepResult = r.value.stepResult;
          data = r.value.data;
        } else {
          const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
          stepResult = { id: s.id, status: "error", error };
          data = null;
        }
        if (stepResult.status === "error") {
          failedSteps.push(s.id);
          const policy = s.on_error ?? "abort";
          if (policy === "abort") sawAbort = true;
          else if (policy === "skip_remaining") sawSkipRemaining = true;
          // `continue`: expose `{ error }` to subsequent steps via templates.
          results.set(s.id, policy === "continue" ? { error: stepResult.error } : data);
        } else {
          results.set(s.id, data);
        }
        stepResults.push(stepResult);
      }

      if (sawAbort) return finalize(false);
      if (sawSkipRemaining) return finalize(false);
      continue;
    }

    const result = await executeOneStep(server, step, results);
    stepResults.push(result.stepResult);

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

    results.set(step.id, result.data);
    i++;
  }

  return finalize(true);
}
