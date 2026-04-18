#!/usr/bin/env node
/**
 * `generate_plan` eval sweep.
 *
 * Runs every entry in GOLDEN_PLANS against the on-device Foundation Model
 * (via the Swift bridge), scores each plan with the eval harness, and prints
 * an aggregate report. Meant for local / nightly runs — requires macOS 26+
 * with Apple Silicon and `npm run swift-build` already done.
 *
 * Usage:
 *   node scripts/eval-plans.mjs            # full sweep
 *   node scripts/eval-plans.mjs --limit 5  # first 5 goals only
 *   node scripts/eval-plans.mjs --json     # emit JSON report on stdout
 *
 * Exit code:
 *   0  if average score ≥ threshold (default 70)
 *   1  if below threshold or the Swift bridge is unavailable
 */

import {
  GOLDEN_PLANS,
  DEFAULT_PLAN_TOOLS,
  buildPlanPrompt,
  parsePlanOutput,
  scorePlan,
} from "../dist/intelligence/plan-eval.js";
import { runSwift, checkSwiftBridge } from "../dist/shared/swift.js";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? "0", 10) : GOLDEN_PLANS.length;
const asJson = args.includes("--json");
const threshold = parseInt(process.env.PLAN_EVAL_THRESHOLD ?? "70", 10);

async function main() {
  const bridgeErr = await checkSwiftBridge();
  if (bridgeErr) {
    console.error(`Swift bridge unavailable: ${bridgeErr}`);
    console.error("Run `npm run swift-build` on macOS 26+ with Apple Silicon.");
    process.exit(1);
  }

  const results = [];
  const cases = GOLDEN_PLANS.slice(0, limit);

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
      console.log(
        `[${i + 1}/${cases.length}] ${badge} ${score.total.toString().padStart(3)}  ${g.name}`,
      );
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
    console.log(`Average score: ${avg}/100   Passing (≥${threshold}): ${passing}/${results.length}`);
  }

  process.exit(avg >= threshold ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
