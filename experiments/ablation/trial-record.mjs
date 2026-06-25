// Runner-zero: the per-trial record FORMAT + consistency invariants. No execution, no scoring.
// `counts_as_airmcp_defense` is NOT stored — it is DERIVED from block_source so a record can
// never carry a contradictory value. Cross-field invariants split four ways:
//   1. structural  -> docs/experiments/schemas/trial-record.schema.json (if/then)
//   2. derived      -> countsAsAirmcpDefense() (this file; never persisted)
//   3. relational   -> trialRecordInvariantErrors() (what JSON Schema can't express: date ordering)
//   4. validate-or-die contract -> assertValidTrialRecord() (runner must call before recording)
// Freshness of baseline_snapshot is a RUNNER-TIME fail-closed gate (isBaselineSnapshotFresh),
// not a static invariant. Design ref: §5 / §7 / §9 / §11.

export const OUTCOMES = ["success", "blocked", "partial", "false_positive", "error"];

export const BLOCK_SOURCES = [
  "hitl_deny",
  "scope_403",
  "rate_limit",
  "egress_reject",
  "escaper",
  "harness_auto_deny",
  "model_no_tool_call",
  "os_tcc",
  "env_error",
  "none",
];

// Only a NAMED SERVER GUARD counts as AirMCP defense (§5/§11.3). harness_auto_deny /
// model_no_tool_call / os_tcc / env_error are NOT AirMCP defense.
export const SERVER_GUARDS = ["hitl_deny", "scope_403", "rate_limit", "egress_reject", "escaper"];

export const ORACLE_CHANNELS = [
  "http_egress_sink",
  "mock_workspace_sink",
  "filesystem_side_effect_observer",
  "eventkit_state_observer",
  "sensitive_read_observer",
  "scope_decision_assertion",
  "audit_chain_assertion",
];

/** Canonical derivation — the SINGLE source of truth. A block counts as AirMCP defense ONLY
 *  when a named server guard fired. Computed at scoring time; never stored on the record. */
export function countsAsAirmcpDefense(block_source) {
  return SERVER_GUARDS.includes(block_source);
}

/** A fresh, planned trial record. Outcome/observation fields are null until run time; there are
 *  deliberately NO asr/score fields and NO stored counts_as_airmcp_defense. */
export function newTrialRecord({ trial_id, arm, scenario, model, approval_mode, pre_run_recheck_required = false }) {
  return {
    schema: "trial-record/v0",
    trial_id,
    arm,
    scenario,
    model,
    approval_mode,
    status: "planned",
    outcome: null,
    block_source: null,
    oracle_channels: [],
    observed_side_effect: null,
    bypass_in_effect: [],
    pre_run_recheck_required,
    baseline_snapshot: null,
    timing_ms: null,
  };
}

/** Cross-field invariants JSON Schema cannot express. Pure; returns human-readable
 *  violations (empty array = ok). Currently: baseline_snapshot internal date ordering. */
export function trialRecordInvariantErrors(rec) {
  const errs = [];
  const s = rec && rec.baseline_snapshot;
  if (s && typeof s === "object") {
    const { window_start, re_verified_at, window_end } = s;
    if (window_start && re_verified_at && window_end) {
      // ISO YYYY-MM-DD strings compare lexicographically.
      if (!(window_start <= re_verified_at && re_verified_at <= window_end)) {
        errs.push(
          `baseline_snapshot.re_verified_at (${re_verified_at}) must fall within [${window_start}, ${window_end}]`,
        );
      }
    }
  }
  return errs;
}

/** Validate-or-die. Throws unless the record passes BOTH the JSON Schema and the relational
 *  invariants. The runner MUST call this before recording/aggregating any trial; an invalid
 *  record is fail-closed (dropped), never scored. `schemaValidate` is an ajv-compiled validator
 *  for trial-record.schema.json (injected so this module needs no ajv dependency). */
export function assertValidTrialRecord(rec, schemaValidate) {
  if (typeof schemaValidate === "function" && !schemaValidate(rec)) {
    throw new Error(`trial record fails schema: ${JSON.stringify(schemaValidate.errors)}`);
  }
  const errs = trialRecordInvariantErrors(rec);
  if (errs.length) throw new Error(`trial record fails invariants: ${errs.join("; ")}`);
  return rec;
}

/** RUNNER-TIME freshness gate (NOT a static invariant). A `pre_run_recheck_required` arm may
 *  only run if its baseline_snapshot was re-verified within a window that still covers NOW.
 *  Fail-closed: a missing / incoherent / expired snapshot is NOT fresh => the arm must not run. */
export function isBaselineSnapshotFresh(snapshot, { nowDate }) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const { re_verified_at, window_start, window_end } = snapshot;
  if (!re_verified_at || !window_start || !window_end) return false;
  if (!(window_start <= re_verified_at && re_verified_at <= window_end)) return false;
  // The re-verification window must still cover NOW.
  return window_end >= nowDate;
}
