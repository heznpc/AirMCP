#!/usr/bin/env node
/**
 * `generate_plan` eval sweep.
 *
 * Runs every entry in GOLDEN_PLANS against the on-device Foundation Model
 * (via the Swift bridge), scores each plan with the eval harness, and prints
 * an aggregate report. It first classifies `ai-status`, then runs one cheap
 * structured-generation smoke before starting the sweep. Meant for local /
 * nightly runs — prepare the opt-in bridge with `npm run swift-build:fm`.
 *
 * Usage:
 *   node scripts/eval-plans.mjs            # full sweep
 *   node scripts/eval-plans.mjs --limit 5  # first 5 goals only
 *   node scripts/eval-plans.mjs --json     # emit JSON report on stdout
 *
 * Exit code:
 *   0  if average score ≥ threshold (default 70)
 *   1  if the smoke or quality threshold fails
 *   2  if the environment/build preflight is blocked
 */

import {
  GOLDEN_PLANS,
  DEFAULT_PLAN_TOOLS,
  buildPlanPrompt,
  parsePlanOutput,
  scorePlan,
} from "../dist/intelligence/plan-eval.js";
import { runSwift, checkSwiftBridge } from "../dist/shared/swift.js";
import { inspectFoundationModels } from "./lib/foundation-models-status.mjs";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? "0", 10) : GOLDEN_PLANS.length;
const asJson = args.includes("--json");
const threshold = parseInt(process.env.PLAN_EVAL_THRESHOLD ?? "70", 10);

function emitBlocked(phase, detail, exitCode) {
  const report = {
    status: "blocked",
    phase,
    classification: detail.classification,
    message: detail.message,
    action: detail.action ?? null,
    total: 0,
    passing: 0,
    avgScore: null,
    threshold,
    results: [],
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`Plan eval blocked during ${phase}: ${detail.classification}`);
    console.error(detail.message);
    if (detail.action) console.error(`Next: ${detail.action}`);
  }
  process.exit(exitCode);
}

async function runSmoke() {
  try {
    const result = await runSwift(
      "generate-structured",
      JSON.stringify({
        prompt: 'Return exactly one JSON object with the string field "status" set to "ok".',
        schema: {
          status: { type: "string", description: 'Must be the literal string "ok".' },
        },
        systemInstruction: "This is a readiness smoke test. Respond with valid JSON only.",
      }),
    );
    const normalized = result.output
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(normalized);
    if (parsed?.status !== "ok") {
      throw new Error(`unexpected structured response: ${result.output?.slice?.(0, 300) ?? "<empty>"}`);
    }
    return { ok: true, command: "generate-structured" };
  } catch (error) {
    return {
      ok: false,
      command: "generate-structured",
      classification: "smoke_failed",
      message: error instanceof Error ? error.message : String(error),
      action: "Run npm run ai-status, then rebuild with npm run swift-build:fm if the status is not ready.",
    };
  }
}

async function main() {
  const preflight = await inspectFoundationModels({ checkSwiftBridge, runSwift });
  if (!preflight.ready) emitBlocked("preflight", preflight, 2);

  const smoke = await runSmoke();
  if (!smoke.ok) emitBlocked("smoke", smoke, 1);

  const results = [];
  const cases = GOLDEN_PLANS.slice(0, limit);

  if (cases.length === 0) {
    emitBlocked(
      "arguments",
      {
        classification: "empty_sweep",
        message: "No plan cases were selected. Use --limit with an integer greater than zero.",
        action: "Rerun without --limit, or pass --limit 1 or greater.",
      },
      1,
    );
  }

  for (const [i, g] of cases.entries()) {
    const prompt = buildPlanPrompt(g.goal, g.context, DEFAULT_PLAN_TOOLS);
    let plan = null;
    let error;
    try {
      const { output } = await runSwift(
        "generate-structured",
        JSON.stringify({
          prompt,
          systemInstruction:
            "You are an action planner. Analyze the goal and available tools, then output a JSON array of steps to achieve the goal. Be practical and concise.",
        }),
      );
      plan = parsePlanOutput(output);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const score = scorePlan(plan, g, DEFAULT_PLAN_TOOLS);
    results.push({ name: g.name, goal: g.goal, score, plan, error });

    if (!asJson) {
      const badge = score.total >= threshold ? "PASS" : "FAIL";
      console.log(`[${i + 1}/${cases.length}] ${badge} ${score.total.toString().padStart(3)}  ${g.name}`);
      if (error) console.log(`    error: ${error}`);
      else if (score.validation.issues.length > 0) {
        console.log(`    issues: ${score.validation.issues.slice(0, 3).join(" | ")}`);
      }
    }
  }

  const avg = Math.round(results.reduce((a, r) => a + r.score.total, 0) / results.length);
  const passing = results.filter((r) => r.score.total >= threshold).length;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          status: "complete",
          preflight: {
            classification: preflight.classification,
            message: preflight.message,
          },
          smoke,
          total: results.length,
          passing,
          avgScore: avg,
          threshold,
          results: results.map((r) => ({
            name: r.name,
            total: r.score.total,
            parts: r.score.parts,
            matchedExpected: r.score.matchedExpected,
            leakedForbidden: r.score.leakedForbidden,
            issues: r.score.validation.issues,
            error: r.error,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log("");
    console.log(`Preflight: ${preflight.classification}; smoke: ${smoke.command} ok`);
    console.log(`Average score: ${avg}/100   Passing (≥${threshold}): ${passing}/${results.length}`);
  }

  process.exit(avg >= threshold ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
