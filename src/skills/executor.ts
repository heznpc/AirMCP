import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition, SkillResult, SkillStep, StepResult } from "./types.js";
import { toolRegistry } from "../shared/tool-registry.js";

const SINGLE_TEMPLATE_RE = /^\{\{([^}]+)\}\}$/;
const EMBEDDED_TEMPLATE_RE = /\{\{([^}]+)\}\}/g;

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

function resolvePath(path: string, results: Map<string, unknown>): unknown {
  const parts = path.split(".");
  const stepId = parts[0]!;
  let current: unknown = results.get(stepId);
  for (let i = 1; i < parts.length && current != null; i++) {
    current = (current as Record<string, unknown>)[parts[i]!];
  }
  return current;
}

/* ------------------------------------------------------------------ */
/*  Lightweight expression evaluator for only_if / skip_if conditions */
/* ------------------------------------------------------------------ */

type Token =
  | { kind: "value"; value: unknown }
  | { kind: "op"; op: string }
  | { kind: "paren"; paren: "(" | ")" };

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
    case "==": return left == right;
    case "!=": return left != right;
    case ">":  return Number(left) >  Number(right);
    case "<":  return Number(left) <  Number(right);
    case ">=": return Number(left) >= Number(right);
    case "<=": return Number(left) <= Number(right);
    default:   return false;
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
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  return toolRegistry.callTool(toolName, args);
}

function parseToolResponse(response: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  if (response.isError) {
    throw new Error(response.content[0]?.text ?? "Tool returned an error");
  }
  const text = response.content[0]?.text;
  if (!text) return null;
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

    const loopResults: unknown[] = [];
    // Use step-scoped loop variables to avoid clobbering shared results in parallel execution
    const loopScope = new Map(results);
    for (let idx = 0; idx < items.length; idx++) {
      loopScope.set("_item", items[idx]);
      loopScope.set("_index", idx);
      const resolvedArgs = (step.args ? resolveTemplates(step.args, loopScope) : {}) as Record<string, unknown>;
      try {
        const response = await callTool(server, step.tool, resolvedArgs);
        loopResults.push(parseToolResponse(response));
      } catch (e) {
        return {
          stepResult: { id: step.id, status: "error", error: e instanceof Error ? e.message : String(e) },
          data: loopResults,
        };
      }
    }
    return { stepResult: { id: step.id, status: "ok", data: loopResults }, data: loopResults };
  }

  const resolvedArgs = (step.args ? resolveTemplates(step.args, results) : {}) as Record<string, unknown>;
  try {
    const response = await callTool(server, step.tool, resolvedArgs);
    const data = parseToolResponse(response);
    return { stepResult: { id: step.id, status: "ok", data }, data };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { stepResult: { id: step.id, status: "error", error }, data: null };
  }
}

export async function executeSkill(
  server: McpServer,
  skill: SkillDefinition,
): Promise<SkillResult> {
  const results = new Map<string, unknown>();
  const stepResults: StepResult[] = [];
  let i = 0;

  while (i < skill.steps.length) {
    const step = skill.steps[i]!;

    if (step.parallel) {
      const group: typeof skill.steps = [];
      while (i < skill.steps.length && skill.steps[i]!.parallel) {
        group.push(skill.steps[i]!);
        i++;
      }

      const settled = await Promise.allSettled(
        group.map((s) => executeOneStep(server, s, results)),
      );

      let failed = false;
      for (let j = 0; j < group.length; j++) {
        const r = settled[j]!;
        if (r.status === "fulfilled") {
          const { stepResult, data } = r.value;
          results.set(group[j]!.id, data);
          stepResults.push(stepResult);
          if (stepResult.status === "error") failed = true;
        } else {
          const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
          results.set(group[j]!.id, null);
          stepResults.push({ id: group[j]!.id, status: "error", error });
          failed = true;
        }
      }

      if (failed) return { skill: skill.name, steps: stepResults, success: false };
      continue;
    }

    const result = await executeOneStep(server, step, results);
    results.set(step.id, result.data);
    stepResults.push(result.stepResult);

    if (result.stepResult.status === "error") {
      return { skill: skill.name, steps: stepResults, success: false };
    }

    i++;
  }

  return { skill: skill.name, steps: stepResults, success: true };
}
