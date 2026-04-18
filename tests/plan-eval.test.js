import { describe, test, expect } from '@jest/globals';
import {
  buildPlanPrompt,
  parsePlanOutput,
  validatePlan,
  scorePlan,
  DEFAULT_PLAN_TOOLS,
  GOLDEN_PLANS,
} from '../dist/intelligence/plan-eval.js';

// ── buildPlanPrompt ────────────────────────────────────────────────
describe('buildPlanPrompt', () => {
  test('includes goal, tool list, and JSON schema instruction', () => {
    const prompt = buildPlanPrompt('Plan my day', undefined);
    expect(prompt).toContain('Goal: Plan my day');
    expect(prompt).toContain('Available tools:');
    for (const t of DEFAULT_PLAN_TOOLS) {
      expect(prompt).toContain(t);
    }
    expect(prompt).toContain('"step"');
    expect(prompt).toContain('Return ONLY the JSON array');
  });

  test('includes context block when provided', () => {
    const prompt = buildPlanPrompt('X', 'meeting at 3pm with Alex');
    expect(prompt).toContain('Context:\nmeeting at 3pm with Alex');
  });

  test('omits context block when empty', () => {
    const prompt = buildPlanPrompt('X', undefined);
    expect(prompt).not.toContain('Context:');
  });

  test('honours a custom tool list', () => {
    const prompt = buildPlanPrompt('Y', undefined, ['only_one']);
    expect(prompt).toContain('Available tools: only_one');
  });
});

// ── parsePlanOutput ────────────────────────────────────────────────
describe('parsePlanOutput', () => {
  const validPlan = [
    { step: 1, tool: 'today_events', args: {}, purpose: 'see schedule' },
    { step: 2, tool: 'list_reminders', args: { completed: false }, purpose: 'see todos' },
  ];

  test('parses clean JSON array', () => {
    const parsed = parsePlanOutput(JSON.stringify(validPlan));
    expect(parsed).toEqual(validPlan);
  });

  test('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(validPlan) + '\n```';
    expect(parsePlanOutput(raw)).toEqual(validPlan);
  });

  test('strips ``` fences without language tag', () => {
    const raw = '```\n' + JSON.stringify(validPlan) + '\n```';
    expect(parsePlanOutput(raw)).toEqual(validPlan);
  });

  test('recovers array from pre/post commentary', () => {
    const raw = `Sure, here is your plan:\n${JSON.stringify(validPlan)}\nHope that helps!`;
    expect(parsePlanOutput(raw)).toEqual(validPlan);
  });

  test('returns null for non-array JSON', () => {
    expect(parsePlanOutput('{"step":1}')).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(parsePlanOutput('this is not json')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(parsePlanOutput('')).toBeNull();
    expect(parsePlanOutput(null)).toBeNull();
    expect(parsePlanOutput(undefined)).toBeNull();
  });

  test('handles empty JSON array', () => {
    expect(parsePlanOutput('[]')).toEqual([]);
  });
});

// ── validatePlan ────────────────────────────────────────────────────
describe('validatePlan', () => {
  test('passes a well-formed plan', () => {
    const plan = [
      { step: 1, tool: 'today_events', args: {}, purpose: 'schedule' },
      { step: 2, tool: 'list_reminders', args: { completed: false }, purpose: 'todos' },
    ];
    const v = validatePlan(plan);
    expect(v.ok).toBe(true);
    expect(v.issues).toHaveLength(0);
    expect(v.unknownTools).toHaveLength(0);
    expect(v.stepCount).toBe(2);
  });

  test('flags null/empty plans', () => {
    expect(validatePlan(null).ok).toBe(false);
    expect(validatePlan([]).ok).toBe(false);
  });

  test('flags out-of-order step numbers', () => {
    const plan = [
      { step: 1, tool: 'today_events', args: {}, purpose: 'a' },
      { step: 5, tool: 'list_reminders', args: {}, purpose: 'b' },
    ];
    const v = validatePlan(plan);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('expected 2'))).toBe(true);
  });

  test('flags missing fields', () => {
    const plan = [{ step: 1, tool: 'today_events', args: {} }]; // missing purpose
    const v = validatePlan(plan);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('purpose'))).toBe(true);
  });

  test('flags non-object args', () => {
    const plan = [{ step: 1, tool: 'today_events', args: 'nope', purpose: 'p' }];
    const v = validatePlan(plan);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('"args"'))).toBe(true);
  });

  test('reports unknown tools (not in allow-list)', () => {
    const plan = [{ step: 1, tool: 'delete_universe', args: {}, purpose: 'p' }];
    const v = validatePlan(plan);
    expect(v.unknownTools).toContain('delete_universe');
  });
});

// ── scorePlan ──────────────────────────────────────────────────────
describe('scorePlan', () => {
  const expected = {
    name: 'organize my day',
    goal: 'Organize my day',
    mustInclude: ['today_events', 'list_reminders'],
    expectedSteps: [2, 5],
  };

  test('perfect plan scores 100', () => {
    const plan = [
      { step: 1, tool: 'today_events', args: {}, purpose: 'check calendar' },
      { step: 2, tool: 'list_reminders', args: { completed: false }, purpose: 'check todos' },
    ];
    const score = scorePlan(plan, expected);
    expect(score.total).toBe(100);
    expect(score.matchedExpected).toEqual(['today_events', 'list_reminders']);
    expect(score.leakedForbidden).toEqual([]);
  });

  test('null plan scores 0', () => {
    const score = scorePlan(null, expected);
    expect(score.total).toBe(0);
  });

  test('missing expected tool reduces coverage score proportionally', () => {
    const plan = [
      { step: 1, tool: 'today_events', args: {}, purpose: 'check calendar' },
      { step: 2, tool: 'today_events', args: {}, purpose: 'recheck' },
    ];
    const score = scorePlan(plan, expected);
    // 30 parseable + 20 structured + 20 allowed + 10 coverage (1/2 × 20) + 10 stepCount = 90
    expect(score.parts.expectedCoverage).toBe(10);
    expect(score.total).toBe(90);
  });

  test('forbidden tool penalizes coverage by 5 per leak', () => {
    const plan = [
      { step: 1, tool: 'today_events', args: {}, purpose: 'a' },
      { step: 2, tool: 'list_reminders', args: {}, purpose: 'b' },
      { step: 3, tool: 'create_note', args: { title: 'x', body: 'y' }, purpose: 'c' },
    ];
    const withAvoid = { ...expected, mustAvoid: ['create_note'], expectedSteps: [2, 5] };
    const score = scorePlan(plan, withAvoid);
    expect(score.leakedForbidden).toEqual(['create_note']);
    expect(score.parts.expectedCoverage).toBe(15); // 20 − 5
  });

  test('step count outside range zeros the stepCount sub-score', () => {
    const plan = [{ step: 1, tool: 'today_events', args: {}, purpose: 'a' }];
    const withRange = { ...expected, expectedSteps: [3, 5] };
    const score = scorePlan(plan, withRange);
    expect(score.parts.stepCount).toBe(0);
  });

  test('unknown tool zeros the allowedTools sub-score', () => {
    const plan = [{ step: 1, tool: 'ban_everyone', args: {}, purpose: 'a' }];
    const score = scorePlan(plan, expected);
    expect(score.parts.allowedTools).toBe(0);
  });
});

// ── GOLDEN_PLANS metadata sanity ───────────────────────────────────
describe('GOLDEN_PLANS', () => {
  test('has at least 20 entries covering diverse workflows', () => {
    expect(GOLDEN_PLANS.length).toBeGreaterThanOrEqual(20);
  });

  test('every entry has a non-empty goal and mustInclude', () => {
    for (const g of GOLDEN_PLANS) {
      expect(g.name).toBeTruthy();
      expect(g.goal).toBeTruthy();
      expect(Array.isArray(g.mustInclude)).toBe(true);
      expect(g.mustInclude.length).toBeGreaterThan(0);
    }
  });

  test('every expected tool is in the default allow-list', () => {
    const allowed = new Set(DEFAULT_PLAN_TOOLS);
    for (const g of GOLDEN_PLANS) {
      for (const t of g.mustInclude) {
        expect(allowed.has(t)).toBe(true);
      }
      for (const t of g.mustAvoid ?? []) {
        expect(allowed.has(t)).toBe(true); // avoid-list also drawn from the same universe
      }
    }
  });

  test('expectedSteps ranges are valid [min, max] with min ≥ 1', () => {
    for (const g of GOLDEN_PLANS) {
      if (!g.expectedSteps) continue;
      const [min, max] = g.expectedSteps;
      expect(min).toBeGreaterThanOrEqual(1);
      expect(max).toBeGreaterThanOrEqual(min);
    }
  });

  test('goal names are unique', () => {
    const names = GOLDEN_PLANS.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('buildPlanPrompt for every golden goal contains the goal text', () => {
    for (const g of GOLDEN_PLANS) {
      const prompt = buildPlanPrompt(g.goal, g.context);
      expect(prompt).toContain(g.goal);
      if (g.context) expect(prompt).toContain(g.context);
    }
  });

  // End-to-end harness check: if the model produced a plan exactly matching
  // `mustInclude`, each golden would score at least 80 (parseable + structured
  // + allowed + full coverage, independent of step-count range).
  test('synthetic "model returns exactly mustInclude" plans score ≥ 80', () => {
    for (const g of GOLDEN_PLANS) {
      const plan = g.mustInclude.map((tool, i) => ({
        step: i + 1,
        tool,
        args: {},
        purpose: `synthetic step for ${g.name}`,
      }));
      const score = scorePlan(plan, g);
      // stepCount may miss if expected range doesn't include mustInclude.length,
      // so accept ≥ 80 (100 − 20 worst-case).
      expect(score.total).toBeGreaterThanOrEqual(80);
    }
  });
});
