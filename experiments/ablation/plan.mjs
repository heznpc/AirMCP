// Runner-zero: static run-matrix plumbing for the defended-vs-undefended ASR ablation.
// Pure + side-effect-free except reading the ratified baseline instance files. NO model
// calls, NO real app automation, NO scoring, NO ASR numbers. Lives outside src/ (unshipped).
// Design ref: docs/experiments/defended-vs-undefended-ablation-design.md §3/§4/§5/§7.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCENARIOS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
export const APPROVAL_MODES = ["ASR_auto", "ASR_humanlike"];

// The defended reference arm. Per-mechanism ablation arms are deferred: they need the
// experiment-layer bypass flags, which are NOT implemented in this PR.
export const AIRMCP_ARM = {
  arm: "airmcp/defended-full",
  kind: "defended",
  re_verified: true,
  sole_primary_data_source: true,
};

/** Load the ratified baseline instance files (read + parse only; schema validation is the
 *  test's / schema's job). Returns instances sorted by filename for determinism. */
export function loadBaselineInstances(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

/** Build the STATIC run matrix (no execution). Every cell is `status: "planned"` and carries
 *  no outcome/score. A not-re-verified undefended arm is flagged for an installability/safety
 *  re-check immediately before it actually runs. */
export function buildRunMatrix({ baselines, scenarios = SCENARIOS, approvalModes = APPROVAL_MODES, models } = {}) {
  // No model is chosen yet (no model calls in runner-zero) — placeholder dimension.
  const modelList = models && models.length ? models : ["<model-TBD>"];

  const arms = [
    AIRMCP_ARM,
    ...baselines.map((b) => ({
      arm: b.baseline_id,
      kind: "undefended",
      capability_mode: b.capability_mode,
      re_verified: b.re_verified,
      sole_primary_data_source: b.sole_primary_data_source,
    })),
  ];

  const cells = [];
  for (const a of arms) {
    for (const scenario of scenarios) {
      for (const model of modelList) {
        for (const approval_mode of approvalModes) {
          cells.push({
            arm: a.arm,
            kind: a.kind,
            re_verified: a.re_verified ?? null,
            sole_primary_data_source: a.sole_primary_data_source ?? null,
            scenario,
            model,
            approval_mode,
            status: "planned",
            // Stale / not-re-verified arms must be re-checked (installability + safety model)
            // right before execution — see REVERIFY receipt + §11.7.
            pre_run_recheck_required: a.kind === "undefended" && a.re_verified === false,
          });
        }
      }
    }
  }
  return cells;
}
