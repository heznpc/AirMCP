/**
 * `generate_plan` evaluation harness.
 *
 * `generate_plan` calls an on-device LLM (Apple Foundation Models) so we can't
 * pin its output byte-for-byte. Instead this module exposes **deterministic**
 * helpers that can be tested in CI and run locally against a real model:
 *
 *   buildPlanPrompt(goal, context, tools)
 *     → exact prompt string sent to the model
 *
 *   parsePlanOutput(raw)
 *     → robust JSON parser that tolerates markdown fences and trailing text
 *
 *   validatePlan(plan, tools)
 *     → structural validation (shape, step numbers, tool allowlist)
 *
 *   scorePlan(plan, expected, tools)
 *     → 0..100 quality score for eval sweeps
 *
 *   GOLDEN_PLANS
 *     → 24 representative goals with expected/forbidden tool sets,
 *       suitable for nightly runs against the real model
 *
 * The `generate_plan` MCP tool continues to own prompt/output I/O; these
 * helpers keep its logic testable without launching the Swift bridge.
 */

/** Single planned action produced by the LLM. */
export interface PlanStep {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  purpose: string;
}

export interface PlanValidation {
  ok: boolean;
  issues: string[];
  unknownTools: string[];
  stepCount: number;
}

export interface PlanScore {
  /** 0..100 composite score. */
  total: number;
  /** Sub-score breakdown. */
  parts: {
    parseable: number; // 0 or 30
    wellStructured: number; // 0..20
    allowedTools: number; // 0..20
    expectedCoverage: number; // 0..20
    stepCount: number; // 0..10
  };
  validation: PlanValidation;
  /** Tools from `expected.mustInclude` that were actually used. */
  matchedExpected: string[];
  /** Tools from `expected.mustAvoid` that leaked into the plan. */
  leakedForbidden: string[];
}

export interface PlanExpectation {
  /** Plain-language label (for reports). */
  name: string;
  /** Goal to pass to `generate_plan`. */
  goal: string;
  /** Optional extra context string. */
  context?: string;
  /** Tools the plan SHOULD call (subset check). */
  mustInclude: string[];
  /** Tools the plan SHOULD NOT call. */
  mustAvoid?: string[];
  /** Acceptable step-count range [min, max]. */
  expectedSteps?: [number, number];
}

/** Default tool allowlist — matches the one baked into `generate_plan`. */
export const DEFAULT_PLAN_TOOLS = [
  "list_notes",
  "search_notes",
  "create_note",
  "list_events",
  "today_events",
  "create_event",
  "list_reminders",
  "create_reminder",
  "list_messages",
  "search_contacts",
  "summarize_text",
  "rewrite_text",
] as const;

/**
 * Build the exact prompt `generate_plan` sends to the model. Kept in sync with
 * the tool's implementation so evaluators can reason about what the model
 * actually sees.
 */
export function buildPlanPrompt(
  goal: string,
  context: string | undefined,
  tools: readonly string[] = DEFAULT_PLAN_TOOLS,
): string {
  return [
    `Goal: ${goal}`,
    context ? `Context:\n${context}` : "",
    `Available tools: ${tools.join(", ")}`,
    "",
    "Generate a JSON array of planned actions. Each action should have:",
    '{"step": 1, "tool": "tool_name", "args": {...}, "purpose": "why this step"}',
    "Return ONLY the JSON array, no other text.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Tolerant JSON-array parser. LLMs frequently decorate outputs with markdown
 * fences (```json … ```), preamble text ("Here is the plan:"), or trailing
 * commentary. This function tries increasingly permissive passes before giving
 * up. Returns `null` if no array can be recovered.
 */
export function parsePlanOutput(raw: string | null | undefined): PlanStep[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Pass 1: straight parse.
  const direct = tryJsonArray(trimmed);
  if (direct) return direct;

  // Pass 2: strip markdown fences, retry.
  const fenceStripped = trimmed
    .replace(/^```(?:json|JSON)?\s*/g, "")
    .replace(/```\s*$/g, "")
    .trim();
  const fenced = tryJsonArray(fenceStripped);
  if (fenced) return fenced;

  // Pass 3: grab the outermost [ ... ] substring.
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    return tryJsonArray(slice);
  }

  return null;
}

function tryJsonArray(s: string): PlanStep[] | null {
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return null;
    // Coerce / filter to step-like objects; non-objects become null entries
    // that validatePlan will flag.
    return parsed.map((x) => x as PlanStep);
  } catch {
    return null;
  }
}

/** Structural validation. Does not opine on plan *quality* — see scorePlan. */
export function validatePlan(plan: PlanStep[] | null, tools: readonly string[] = DEFAULT_PLAN_TOOLS): PlanValidation {
  const issues: string[] = [];
  const unknownTools: string[] = [];

  if (!plan) {
    return { ok: false, issues: ["Plan could not be parsed."], unknownTools, stepCount: 0 };
  }
  if (plan.length === 0) {
    return { ok: false, issues: ["Plan is empty."], unknownTools, stepCount: 0 };
  }

  const allowed = new Set(tools);
  let expectedStep = 1;

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i] as unknown;
    if (!step || typeof step !== "object") {
      issues.push(`Step ${i + 1} is not an object.`);
      continue;
    }
    const s = step as Partial<PlanStep>;
    if (typeof s.step !== "number") issues.push(`Step ${i + 1} missing numeric "step".`);
    else if (s.step !== expectedStep) {
      issues.push(`Step ${i + 1} numbered ${s.step} — expected ${expectedStep}.`);
    }
    if (typeof s.tool !== "string" || s.tool.length === 0) {
      issues.push(`Step ${i + 1} missing "tool".`);
    } else if (!allowed.has(s.tool)) {
      unknownTools.push(s.tool);
    }
    if (typeof s.args !== "object" || s.args === null || Array.isArray(s.args)) {
      issues.push(`Step ${i + 1} "args" must be an object.`);
    }
    if (typeof s.purpose !== "string" || s.purpose.length === 0) {
      issues.push(`Step ${i + 1} missing "purpose".`);
    }
    expectedStep++;
  }

  return {
    ok: issues.length === 0,
    issues,
    unknownTools: [...new Set(unknownTools)],
    stepCount: plan.length,
  };
}

/**
 * Score a plan against an expectation. Useful to aggregate pass rates across
 * the GOLDEN_PLANS golden set.
 *
 * Breakdown (100 total):
 *   parseable          30 — plan is valid JSON array of objects
 *   wellStructured     20 — no structural issues (step numbering, shape)
 *   allowedTools       20 — every tool is in the allow-list
 *   expectedCoverage   20 — all `mustInclude` tools appear, no `mustAvoid` leak
 *   stepCount          10 — step count inside expected range
 */
export function scorePlan(
  plan: PlanStep[] | null,
  expected: PlanExpectation,
  tools: readonly string[] = DEFAULT_PLAN_TOOLS,
): PlanScore {
  const validation = validatePlan(plan, tools);
  const hasPlan = !!plan && plan.length > 0;

  // All sub-scores short-circuit to zero when there's nothing to evaluate —
  // otherwise a missing plan would still pick up "no unknown tools = 20".
  const parseable = hasPlan ? 30 : 0;
  const wellStructured = hasPlan && validation.issues.length === 0 ? 20 : 0;
  const allowedTools = hasPlan && validation.unknownTools.length === 0 ? 20 : 0;

  const usedTools = new Set((plan ?? []).map((s) => s?.tool).filter((t): t is string => !!t));
  const matchedExpected = expected.mustInclude.filter((t) => usedTools.has(t));
  const leakedForbidden = (expected.mustAvoid ?? []).filter((t) => usedTools.has(t));

  let expectedCoverage = 0;
  if (hasPlan && expected.mustInclude.length > 0) {
    const hitRate = matchedExpected.length / expected.mustInclude.length;
    expectedCoverage = Math.round(hitRate * 20);
  }
  // Penalize forbidden leaks: subtract 5 per leaked tool, floor at 0.
  expectedCoverage = Math.max(0, expectedCoverage - leakedForbidden.length * 5);

  let stepCountScore = 0;
  if (hasPlan) {
    if (expected.expectedSteps) {
      const [min, max] = expected.expectedSteps;
      const n = plan!.length;
      stepCountScore = n >= min && n <= max ? 10 : 0;
    } else {
      stepCountScore = 10;
    }
  }

  const total = parseable + wellStructured + allowedTools + expectedCoverage + stepCountScore;

  return {
    total,
    parts: {
      parseable,
      wellStructured,
      allowedTools,
      expectedCoverage,
      stepCount: stepCountScore,
    },
    validation,
    matchedExpected,
    leakedForbidden,
  };
}

/**
 * Golden set — 24 representative goals covering daily planning, notes,
 * calendar, contacts, messaging, and cross-app workflows. Used both by unit
 * tests (against synthetic plans) and nightly eval sweeps against the real
 * Foundation Model.
 *
 * Guidelines:
 *   • `mustInclude` is a SUBSET check: extra relevant tools are fine.
 *   • `mustAvoid` covers clearly wrong choices (e.g. destructive tools for
 *     read-only goals).
 *   • `expectedSteps` ranges are generous — the scorer rewards ballpark sizing,
 *     not exact counts.
 */
export const GOLDEN_PLANS: PlanExpectation[] = [
  // ── Daily planning ────────────────────────────────────────────────
  {
    name: "organize my day",
    goal: "Organize my day",
    mustInclude: ["today_events", "list_reminders"],
    expectedSteps: [2, 5],
  },
  {
    name: "prepare for morning meeting",
    goal: "Help me prepare for my morning meeting",
    mustInclude: ["today_events"],
    expectedSteps: [1, 5],
  },
  {
    name: "today's to-do list",
    goal: "What's left on my to-do list today?",
    mustInclude: ["list_reminders"],
    expectedSteps: [1, 3],
  },
  {
    name: "tomorrow's calendar",
    goal: "Tell me what's on my calendar tomorrow",
    mustInclude: ["list_events"],
    expectedSteps: [1, 3],
  },
  {
    name: "remind me to call mom",
    goal: "Remind me to call mom this evening at 7pm",
    mustInclude: ["create_reminder"],
    expectedSteps: [1, 2],
  },

  // ── Notes / ideation ──────────────────────────────────────────────
  {
    name: "find project notes",
    goal: "Find my notes about Project Aurora",
    mustInclude: ["search_notes"],
    expectedSteps: [1, 2],
  },
  {
    name: "capture quick idea",
    goal: "Create a quick note capturing this idea: move Q2 retro to Friday",
    mustInclude: ["create_note"],
    expectedSteps: [1, 2],
  },
  {
    name: "summarize last 3 notes",
    goal: "Summarize my last three notes",
    mustInclude: ["list_notes", "summarize_text"],
    expectedSteps: [2, 4],
  },
  {
    name: "tighten paragraph",
    goal: "Rewrite this paragraph to be more concise",
    context: "I think we should probably, in general, consider moving the meeting.",
    mustInclude: ["rewrite_text"],
    expectedSteps: [1, 2],
  },

  // ── Communication ────────────────────────────────────────────────
  {
    name: "recent chats",
    goal: "Who have I been messaging lately?",
    mustInclude: ["list_messages"],
    expectedSteps: [1, 3],
  },
  {
    name: "find contact info",
    goal: "Find Sarah Kim's phone number",
    mustInclude: ["search_contacts"],
    expectedSteps: [1, 2],
  },

  // ── Calendar ──────────────────────────────────────────────────────
  {
    name: "book appointment",
    goal: "Schedule a dentist appointment for next Tuesday at 2pm",
    mustInclude: ["create_event"],
    expectedSteps: [1, 2],
  },
  {
    name: "find time for coffee",
    goal: "Find time for a 30-minute coffee chat this week",
    mustInclude: ["list_events"],
    expectedSteps: [1, 3],
  },
  {
    name: "this week's meetings",
    goal: "What meetings do I have this week?",
    mustInclude: ["list_events"],
    expectedSteps: [1, 2],
  },

  // ── Cross-app ────────────────────────────────────────────────────
  {
    name: "prep for 1:1",
    goal: "Prep for my 3pm one-on-one with Alex",
    mustInclude: ["today_events", "search_notes"],
    expectedSteps: [2, 5],
  },
  {
    name: "capture standup action items",
    goal: "Write up the action items from today's standup",
    mustInclude: ["search_notes", "create_note"],
    expectedSteps: [2, 4],
  },
  {
    name: "weekly review",
    goal: "Do a weekly review of my week",
    mustInclude: ["list_events", "list_reminders", "list_notes"],
    expectedSteps: [3, 6],
  },
  {
    name: "invite colleague to lunch",
    goal: "Invite Maya to lunch tomorrow at noon",
    mustInclude: ["search_contacts", "create_event"],
    expectedSteps: [2, 3],
  },

  // ── Recall / retrieval ────────────────────────────────────────────
  {
    name: "design review notes",
    goal: "What did I write about the design review yesterday?",
    mustInclude: ["search_notes"],
    expectedSteps: [1, 2],
  },
  {
    name: "birthdays this month",
    goal: "Find upcoming birthdays this month",
    mustInclude: ["search_contacts"],
    expectedSteps: [1, 2],
  },

  // ── Writing / tone ────────────────────────────────────────────────
  {
    name: "draft thank-you note",
    goal: "Draft a quick note thanking the team for the launch",
    mustInclude: ["create_note"],
    expectedSteps: [1, 3],
  },
  {
    name: "rewrite to formal",
    goal: "Rewrite this message to sound more formal",
    context: "hey! can u send the doc? thx",
    mustInclude: ["rewrite_text"],
    expectedSteps: [1, 2],
  },

  // ── Edge: minimal-action goals ────────────────────────────────────
  {
    name: "single-step reminder",
    goal: "Remind me to water the plants tomorrow morning",
    mustInclude: ["create_reminder"],
    expectedSteps: [1, 1],
  },
  {
    name: "single-step event",
    goal: "Block 9-10am tomorrow for deep work",
    mustInclude: ["create_event"],
    expectedSteps: [1, 1],
  },
];
