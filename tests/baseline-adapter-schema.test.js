/**
 * baseline-adapter.schema.json contract test (executable, not description).
 *
 * Validates positive/negative fixtures against the ACTUAL schema with ajv
 * (draft 2020-12). This is the "failing test fixes the contract" the design
 * asks for: every invariant in the schema is exercised by a fixture that must
 * pass or must be rejected. Design ref: harness-safety-preflight §2; ablation §3/§11.5.
 */
import { describe, test, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(
  readFileSync(join(ROOT, "docs", "experiments", "schemas", "baseline-adapter.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const CONFORMANCE_OK = {
  no_content_modification: true,
  no_self_gating_beyond_shared_approver: true,
  no_sanitization_or_rewriting: true,
  passes_through_errors_and_results: true,
  out_of_set_refusal_owner: "harness_dispatcher",
  native_tcc_prompt_counts_as_defense: false,
};

const BASE = {
  version: "0.2.0-proposed",
  status: "proposed",
  baseline_id: "steipete/macos-automator-mcp",
  capability_mode: "capability-matched",
  re_verified: false,
  sole_primary_data_source: false,
  same_fixture_source: true,
  same_task_interface: true,
  same_allowed_action_set: true,
  same_scenario_corpus: true,
  no_per_scenario_exploit: true,
  no_per_arm_exploit: true,
  conformance: { ...CONFORMANCE_OK },
};

const VALID = {
  "matched, unverified, not sole-primary": { ...BASE },
  "matched, re_verified, sole-primary allowed": {
    ...BASE,
    baseline_id: "joshrutkowski/applescript-mcp",
    re_verified: true,
    sole_primary_data_source: true,
  },
  "native, secondary, not sole-primary": {
    ...BASE,
    capability_mode: "capability-native",
    same_allowed_action_set: false,
    re_verified: true,
    sole_primary_data_source: false,
  },
};

const INVALID = {
  "native claiming sole-primary": {
    ...BASE,
    capability_mode: "capability-native",
    same_allowed_action_set: false,
    re_verified: true,
    sole_primary_data_source: true,
  },
  "unverified claiming sole-primary": { ...BASE, re_verified: false, sole_primary_data_source: true },
  "matched without same_allowed_action_set": { ...BASE, same_allowed_action_set: false },
  "adapter owning out-of-set refusal": {
    ...BASE,
    conformance: { ...CONFORMANCE_OK, out_of_set_refusal_owner: "adapter" },
  },
  "native TCC counted as defense": {
    ...BASE,
    conformance: { ...CONFORMANCE_OK, native_tcc_prompt_counts_as_defense: true },
  },
  "legacy role field present (role is removed)": { ...BASE, role: "primary" },
  "missing conformance block": (() => {
    const o = { ...BASE };
    delete o.conformance;
    return o;
  })(),
};

describe("baseline-adapter schema — positive fixtures validate", () => {
  for (const [name, instance] of Object.entries(VALID)) {
    test(name, () => {
      expect(validate(instance)).toBe(true);
    });
  }
});

describe("baseline-adapter schema — negative fixtures are rejected", () => {
  for (const [name, instance] of Object.entries(INVALID)) {
    test(name, () => {
      expect(validate(instance)).toBe(false);
    });
  }
});
