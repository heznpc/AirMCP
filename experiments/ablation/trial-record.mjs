// Runner-zero: the per-trial record FORMAT + metadata fields. No execution, no scoring.
// The record is filled at run time by a later PR; here we only fix its shape and the
// taxonomy helpers. Validated against docs/experiments/schemas/trial-record.schema.json.
// Design ref: §5 (outcome taxonomy + block_source), §7 (per-trial record), §11.

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

/** A block is credited to AirMCP's defense ONLY when a named server guard fired. */
export function countsAsAirmcpDefense(block_source) {
  return SERVER_GUARDS.includes(block_source);
}

/** An empty, planned trial record. Outcome/observation fields are null until run time; there
 *  are deliberately NO asr / score / percentage fields (forbidden until measured). */
export function newTrialRecord({ trial_id, arm, scenario, model, approval_mode }) {
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
    counts_as_airmcp_defense: null,
    oracle_channels: [],
    observed_side_effect: null, // oracle observation only; model self-report is NOT an oracle
    bypass_in_effect: [], // §11.1 metadata: which defenses (if any) were bypassed this trial
    baseline_snapshot: null, // provenance: re_verified / pushed_at at run time
    timing_ms: null,
  };
}
