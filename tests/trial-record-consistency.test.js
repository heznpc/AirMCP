/**
 * Trial-record consistency guard (no execution).
 *
 * Locks the cross-field invariants of a trial record so a "measurement record" can never be
 * internally contradictory. Four-way split:
 *   - structural (status/outcome/block_source coupling) -> JSON Schema if/then
 *   - derived (counts_as_airmcp_defense) -> NOT stored; derived via countsAsAirmcpDefense()
 *   - relational (baseline_snapshot date ordering) -> trialRecordInvariantErrors()
 *   - validate-or-die -> assertValidTrialRecord() (runner must call before recording)
 * baseline_snapshot FRESHNESS is a runner-time fail-closed gate (isBaselineSnapshotFresh).
 * No model calls, no app automation, no scoring, no ASR numbers. Design ref: §5/§7/§9/§11.
 */
import { describe, test, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import {
  newTrialRecord,
  assertValidTrialRecord,
  trialRecordInvariantErrors,
  isBaselineSnapshotFresh,
  countsAsAirmcpDefense,
  SERVER_GUARDS,
} from "../experiments/ablation/trial-record.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(
  JSON.parse(readFileSync(join(ROOT, "docs", "experiments", "schemas", "trial-record.schema.json"), "utf8")),
);

const planned = (over = {}) => ({
  ...newTrialRecord({ trial_id: "t", arm: "a", scenario: "S1", model: "m", approval_mode: "ASR_auto" }),
  ...over,
});
const ran = (over = {}) => ({
  ...planned(),
  status: "ran",
  outcome: "success",
  block_source: "none",
  observed_side_effect: {},
  timing_ms: 1,
  ...over,
});
const FRESH_SNAP = {
  pushed_at: "2026-06-23",
  re_verified_at: "2026-06-25",
  window_start: "2026-03-27",
  window_end: "2026-06-25",
};

describe("trial-record — valid records pass schema + invariants", () => {
  const cases = {
    "planned (fresh from newTrialRecord)": planned(),
    "ran / success / none": ran(),
    "ran / blocked / hitl_deny": ran({ outcome: "blocked", block_source: "hitl_deny" }),
    "ran / false_positive / escaper": ran({ outcome: "false_positive", block_source: "escaper" }),
    "errored / error / env_error": ran({ status: "errored", outcome: "error", block_source: "env_error" }),
    "ran + recheck + fresh snapshot": ran({ pre_run_recheck_required: true, baseline_snapshot: FRESH_SNAP }),
  };
  for (const [name, rec] of Object.entries(cases)) {
    test(name, () => {
      const ok = validate(rec);
      if (!ok) console.error(name, validate.errors);
      expect(ok).toBe(true);
      expect(() => assertValidTrialRecord(rec, validate)).not.toThrow();
    });
  }
});

describe("trial-record — contradictory records are rejected by the schema", () => {
  const cases = {
    "planned cannot carry a measured outcome": planned({ outcome: "blocked", block_source: "hitl_deny" }),
    "errored must be env_error, not a guard": ran({ status: "errored", outcome: "error", block_source: "hitl_deny" }),
    "ran cannot have outcome=error": ran({ outcome: "error" }),
    "success cannot have a block_source": ran({ outcome: "success", block_source: "hitl_deny" }),
    "blocked cannot be block_source=none": ran({ outcome: "blocked", block_source: "none" }),
    "blocked cannot be block_source=env_error": ran({ outcome: "blocked", block_source: "env_error" }),
    "false_positive cannot be none": ran({ outcome: "false_positive", block_source: "none" }),
    "env_error only with errored status": ran({ outcome: "partial", block_source: "env_error" }),
    "ran + recheck without a baseline_snapshot": ran({ pre_run_recheck_required: true, baseline_snapshot: null }),
    "no stored counts_as_airmcp_defense field": ran({ counts_as_airmcp_defense: true }),
    "no stored asr/score field": ran({ asr: 0.42 }),
  };
  for (const [name, rec] of Object.entries(cases)) {
    test(name, () => {
      expect(validate(rec)).toBe(false);
    });
  }
});

describe("trial-record — relational invariant (schema can't express date ordering)", () => {
  test("re_verified_at outside the window is schema-valid but invariant-invalid (validate-or-die catches it)", () => {
    const rec = ran({
      pre_run_recheck_required: true,
      baseline_snapshot: { ...FRESH_SNAP, re_verified_at: "2026-01-01" }, // before window_start
    });
    expect(validate(rec)).toBe(true); // shape is fine
    expect(trialRecordInvariantErrors(rec).length).toBeGreaterThan(0);
    expect(() => assertValidTrialRecord(rec, validate)).toThrow(/re_verified_at/);
  });
});

describe("trial-record — derived counts (never stored)", () => {
  test("only a named server guard counts as AirMCP defense", () => {
    for (const g of SERVER_GUARDS) expect(countsAsAirmcpDefense(g)).toBe(true);
    for (const g of ["harness_auto_deny", "model_no_tool_call", "os_tcc", "env_error", "none"]) {
      expect(countsAsAirmcpDefense(g)).toBe(false);
    }
  });
});

describe("trial-record — baseline-snapshot freshness (runner-time fail-closed gate)", () => {
  test("a coherent, non-expired snapshot is fresh", () => {
    expect(isBaselineSnapshotFresh(FRESH_SNAP, { nowDate: "2026-06-25" })).toBe(true);
  });
  test("an expired re-verification window is NOT fresh", () => {
    expect(isBaselineSnapshotFresh({ ...FRESH_SNAP, window_end: "2026-05-01" }, { nowDate: "2026-06-25" })).toBe(false);
  });
  test("a missing or incoherent snapshot is NOT fresh (fail-closed)", () => {
    expect(isBaselineSnapshotFresh(null, { nowDate: "2026-06-25" })).toBe(false);
    expect(isBaselineSnapshotFresh({ ...FRESH_SNAP, re_verified_at: "2026-01-01" }, { nowDate: "2026-06-25" })).toBe(false);
  });
});
