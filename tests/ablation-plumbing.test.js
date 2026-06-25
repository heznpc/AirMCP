/**
 * Runner-zero plumbing integrity (NO execution).
 *
 * Verifies the measurement plumbing without running anything: the ratified baseline
 * instances load + schema-validate (fail if invalid), the static run matrix is built with
 * the expected shape + the pre-run-recheck flags, the trial-record format validates, and the
 * "only a named server guard counts as AirMCP defense" rule holds. NO model calls, NO real
 * app automation, NO scoring, NO ASR numbers. Design ref: §3/§4/§5/§7/§11.
 */
import { describe, test, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import {
  SCENARIOS,
  APPROVAL_MODES,
  AIRMCP_ARM,
  loadBaselineInstances,
  buildRunMatrix,
} from "../experiments/ablation/plan.mjs";
import {
  newTrialRecord,
  countsAsAirmcpDefense,
  ORACLE_CHANNELS,
  SERVER_GUARDS,
} from "../experiments/ablation/trial-record.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMAS = join(ROOT, "docs", "experiments", "schemas");
const BASELINES = join(ROOT, "docs", "experiments", "baselines");

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateBaseline = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMAS, "baseline-adapter.schema.json"), "utf8")),
);
const validateTrial = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMAS, "trial-record.schema.json"), "utf8")),
);

const noNumbersLeak = (obj) =>
  Object.keys(obj).filter((k) => /asr|score|percent/i.test(k));

describe("runner-zero — baseline instances load + validate", () => {
  const instances = loadBaselineInstances(BASELINES);

  test("loads the ratified baseline instances", () => {
    expect(instances.length).toBeGreaterThanOrEqual(3);
  });

  test("every instance schema-validates (fail if not)", () => {
    for (const inst of instances) {
      const { file, ...instance } = inst; // `file` is a loader annotation, not part of the schema
      const ok = validateBaseline(instance);
      if (!ok) console.error(file, validateBaseline.errors);
      expect(ok).toBe(true);
    }
  });

  test("a not-re-verified baseline never claims sole-primary (load-bearing, on real data)", () => {
    for (const inst of instances) {
      if (inst.re_verified === false) expect(inst.sole_primary_data_source).toBe(false);
    }
  });
});

describe("runner-zero — static run matrix (no execution)", () => {
  const baselines = loadBaselineInstances(BASELINES);
  const cells = buildRunMatrix({ baselines });

  test("cell count = arms x scenarios x models(placeholder) x approval-modes", () => {
    const arms = 1 + baselines.length; // airmcp + baselines
    expect(cells.length).toBe(arms * SCENARIOS.length * 1 * APPROVAL_MODES.length);
  });

  test("every cell is planned and carries NO result/score field", () => {
    for (const c of cells) {
      expect(c.status).toBe("planned");
      expect(noNumbersLeak(c)).toEqual([]);
      expect("outcome" in c).toBe(false); // outcome lives on the trial record, not the plan cell
    }
  });

  test("not-re-verified undefended arms are flagged for a pre-run re-check; airmcp + re-verified are not", () => {
    const recheckArms = new Set(cells.filter((c) => c.pre_run_recheck_required).map((c) => c.arm));
    const noRecheckArms = new Set(cells.filter((c) => !c.pre_run_recheck_required).map((c) => c.arm));
    // The defended arm and any re_verified baseline must NOT require a pre-run re-check.
    expect(noRecheckArms.has(AIRMCP_ARM.arm)).toBe(true);
    // Exactly the re_verified===false baselines require it.
    const expectRecheck = new Set(
      baselines.filter((b) => b.re_verified === false).map((b) => b.baseline_id),
    );
    expect(recheckArms).toEqual(expectRecheck);
  });
});

describe("runner-zero — trial-record format + defense attribution", () => {
  test("a fresh trial record is planned, has no scores, and validates against the schema", () => {
    const rec = newTrialRecord({
      trial_id: "t-0001",
      arm: "airmcp/defended-full",
      scenario: "S1",
      model: "<model-TBD>",
      approval_mode: "ASR_auto",
    });
    expect(rec.status).toBe("planned");
    expect(noNumbersLeak(rec)).toEqual([]);
    const ok = validateTrial(rec);
    if (!ok) console.error(validateTrial.errors);
    expect(ok).toBe(true);
  });

  test("the schema rejects a stray result field (no ASR numbers permitted)", () => {
    const rec = newTrialRecord({ trial_id: "t", arm: "a", scenario: "S2", model: "m", approval_mode: "ASR_humanlike" });
    expect(validateTrial({ ...rec, asr: 0.42 })).toBe(false);
  });

  test("only a named server guard counts as AirMCP defense", () => {
    for (const g of SERVER_GUARDS) expect(countsAsAirmcpDefense(g)).toBe(true);
    for (const g of ["harness_auto_deny", "model_no_tool_call", "os_tcc", "env_error", "none"]) {
      expect(countsAsAirmcpDefense(g)).toBe(false);
    }
  });

  test("the trial-record oracle channels match the ratified 7-channel set", () => {
    const oracleSchema = JSON.parse(readFileSync(join(SCHEMAS, "oracle-mapping.schema.json"), "utf8"));
    const schemaChannels = oracleSchema.properties.channels.items.enum;
    expect([...ORACLE_CHANNELS].sort()).toEqual([...schemaChannels].sort());
  });
});
