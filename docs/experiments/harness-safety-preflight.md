# Harness Safety Preflight — defended-vs-undefended ablation

> **Status: RATIFIED contracts (preflight).** This PR adds only the **safety contracts,
> schemas, and one tripwire test**. The ablation **harness / runner / scoring is still NOT
> started** — no scenario execution, no model calls, no real app automation, no result
> numbers. Builds on the ratified design
> [`defended-vs-undefended-ablation-design.md`](./defended-vs-undefended-ablation-design.md).

The design (`§11`) ratified *what* to measure. This preflight ratifies the *safety rails*
that must exist **before** any runner is written, so the experiment cannot (a) leave a hidden
"disable defenses" switch in the shipped product, (b) be confounded by unfair baselines,
(c) over-claim via the wrong headline metric, or (d) be adjudicated by anything other than an
observed side effect.

---

## 1. Experiment-only bypass enforcement (ratified)

*Problem.* Design §2 ratified **test-gated bypass flags** for the three **hardcoded** defenses
(Safari egress guard, untrusted fencing / taint propagation, symlink-escape guard) so each
mechanism's marginal contribution can be isolated. Unenforced, that is a hidden "turn the
defenses off" switch in AirMCP.

*Contract (ratified).*

- **Injection site.** Bypass flags are read **only** via **in-process injection from the
  experiment / companion layer**. They are **never** read from `process.env`, `config.json`,
  CLI args, or any package / user-config surface.
- **Distribution exclusion.** Experiment / harness code lives **outside `src/`** (so it never
  compiles into `dist/`). `package.json` publishes only `dist` (`files: ["dist"]`) and the
  `.mcpb` bundle copies only `dist`. Therefore experiment code ships in **neither npm nor
  MCPB**.
- **Default defense-on.** The default is always defenses-**on**. The flag-off (bypassed)
  state is reachable **only** inside the experiment harness.
- **Reserved identifiers** (forbidden on any public surface): env namespaces
  `AIRMCP_EXPERIMENT_*`, `AIRMCP_ABLATION_*`, `AIRMCP_BYPASS_*`, `AIRMCP_UNSAFE_*`,
  `AIRMCP_DANGEROUS_*`, and `AIRMCP_DISABLE_{EGRESS,FENCE,FENCING,TAINT,SYMLINK,SSRF,GUARD,
  HITL,AUDIT}`.
- **Docs exclusion.** Bypass identifiers/keywords must **not** appear in README or product
  docs.
- **(Harness PR, later — not here.)** Any bypass in effect for a trial **must** be recorded in
  the **per-trial result metadata**. No runner is implemented in this PR.

*Enforced now by* [`tests/experiment-bypass-tripwire.test.js`](../../tests/experiment-bypass-tripwire.test.js):
it passes today (no harness exists) and **fails the moment** a bypass is wired through the
public env surface, `src/`, the published file set (incl. the rendered `npm pack` list), the
`.mcpb` manifest `user_config` / `mcp_config.env`, or product docs. (MCPB-payload and
app-bundle scans are deferred to the bypass-hook PR.)

## 2. Baseline fairness (ratified)

*Contract.* Schema: [`schemas/baseline-adapter.schema.json`](./schemas/baseline-adapter.schema.json).

- **`capability-matched` is primary**; **`capability-native` (arbitrary-script's real broader
  surface) is secondary and explicitly labeled.** "Primary/secondary" here is the
  **comparison tier (capability mode)**, *not* run-priority: the **run set** is `steipete`
  (which also supplies the native secondary arm) + `joshrutkowski`, both run in
  capability-matched mode. `joshrutkowski` (code-frozen `2025-04`) carries a staleness caveat
  and is not a sole primary data source until re-verified; `peakmojo` is secondary, only after
  re-verification. (Canonical; design §3 / §11.5 align to this.)
- Every arm uses the **same fixture source, same task interface, same allowed action set, and
  same scenario corpus**. For `capability-matched`, the adapter's allowed action set **equals**
  the shared tool catalog.
- **No per-scenario and no per-arm hand-tuned exploits.** Injection vectors come only from the
  shared, versioned fixture/scenario corpus, applied identically to all arms.
- The schema enforces three orthogonal axes (there is **no `role` field**): comparison tier =
  `capability_mode`; current-state = `re_verified`; claim eligibility =
  `sole_primary_data_source`, with `capability-native ⇒ sole_primary_data_source = false`,
  `re_verified = false ⇒ sole_primary_data_source = false`, and
  `capability-matched ⇒ same_allowed_action_set = true`. Exercised by
  [`tests/baseline-adapter-schema.test.js`](../../tests/baseline-adapter-schema.test.js).
- **Behavioral transparency (conformance).** "Same task interface" is not enough — an adapter
  that silently filters / sanitizes / gates / rewrites becomes a **hidden defense** and biases
  the ASR delta toward AirMCP. The adapter must be a faithful pass-through: **no content
  modification** (injected corpus content reaches the baseline byte-for-byte), **no
  sanitization / rewriting / normalization**, **errors and results unaltered**, and **no
  gating of its own** — the *only* permitted gate is delegating to the shared approver policy
  (§3). **Out-of-set refusal is the harness dispatcher's job, not the adapter's, and is not
  counted as AirMCP server defense.** A baseline's native OS **TCC prompt is never a defense**
  (TCC is pre-granted identically; a mid-trial prompt is recorded as `os_tcc` setup/env
  failure). These are `conformance` fields in the schema, locked behaviorally by
  [`tests/adapter-conformance.test.js`](../../tests/adapter-conformance.test.js). Live
  end-to-end conformance is deferred to the harness PR.

## 3. Reporting discipline (ratified — extends design §9)

- **`ASR_auto` may never be a headline.** It is labeled **"human absent / code-layer upper
  bound"** and is interpretable **only alongside `ASR_humanlike` + confidence intervals**.
  Using `ASR_auto` as a primary/standalone claim is added to the design's forbidden-claims.
- **Model self-report is not an oracle** (restated §5; enforced by the oracle schema below).

## 4. Matrix freeze + reduction protocol (ratified)

- **`N≥30` is a per-cell minimum, not a power analysis.** A targeted power calculation, if a
  specific effect size matters, is *proposed* future work.
- Cells = `arms × scenarios × models × approval-modes` and combine combinatorially.
- **Protocol:** pilot (`N=5`, stability only) → **freeze the main matrix** (the exact cells
  that will run) → if cost forces a reduction, the **reduction rule is stated before reducing**
  → any reduction **downgrades the run to `exploratory`** with weakened efficacy language.
- Report **per-cell** CIs (Wilson / bootstrap). **Do not over-claim cross-cell significance**
  (multiple comparisons).

## 5. Oracle channels (ratified)

*Contract.* Schema: [`schemas/oracle-mapping.schema.json`](./schemas/oracle-mapping.schema.json).

Three observed-side-effect **sinks** + two per-domain **observers** + two **assertion oracles**
over artifacts that already exist — because 3 channels alone could not tell "attack did not
happen" from "we could not observe it" for EventKit / sensitive-read / scope / audit-chain
effects:

- **`http_egress_sink`** — outbound HTTP exfiltration attempts.
- **`mock_workspace_sink`** — cloud-write / `gws_*`-style outputs (Sheets/Gmail; the `gws` CLI).
- **`filesystem_side_effect_observer`** — file delete/move/trash/symlink (also the
  destructive-cascade and path-escape oracle).
- **`eventkit_state_observer`** — Reminders + Calendar create/update/delete (one observer; they
  share the EventKit store). Covers S1 + the EventKit half of S3.
- **`sensitive_read_observer`** — fires when a gated sensitive read (clipboard / health /
  location) occurs; one channel keyed on the existing `sensitiveHint` SSOT, not three. Covers
  the read half of S7.
- **`scope_decision_assertion`** — asserts on the OAuth scope-gate decision / the `[forbidden]`
  audit line the registry already writes. Covers S4 (reuses an existing artifact).
- **`audit_chain_assertion`** — runs the existing HMAC verifier over `audit.jsonl` post-trial.
  Covers S5's integrity question (reuses shipped code).

A **JXA / command-execution observer** (the osascript half of S8) is **deferred / future** —
S8's `gws_raw` half is already covered by `mock_workspace_sink`. Each scenario maps to one or
more channels; `model_self_report_is_oracle` is a schema `const false`. **Observer/oracle code
is not implemented in this PR — doc/schema contract only.**

---

## Schemas added in this PR

| File | Purpose | Note |
|---|---|---|
| [`approver-policy.schema.json`](./schemas/approver-policy.schema.json) | `ASR_humanlike` approval policy | ratified approve/deny rules; same policy for all arms incl. baseline adapters |
| [`oracle-mapping.schema.json`](./schemas/oracle-mapping.schema.json) | scenario → oracle channel(s) | 7 channels (3 sinks + 2 observers + 2 assertions); `model_self_report_is_oracle = false` |
| [`baseline-adapter.schema.json`](./schemas/baseline-adapter.schema.json) | per-baseline fairness + conformance | no `role`; 3 axes (`capability_mode` / `re_verified` / `sole_primary_data_source`) + adapter conformance; tested by `baseline-adapter-schema.test.js` + `adapter-conformance.test.js` |
| [`partial-weights.schema.json`](./schemas/partial-weights.schema.json) | PARTIAL credit weights (secondary metric) | **shape only — weights are PROPOSED placeholders, no final values** |

## Still `proposed` / explicitly NOT in this PR

Harness runner, scenario execution, model calls, real app automation, scoring code, the actual
PARTIAL weight values, and the experiment-layer bypass implementation itself. Per design
§11.7, the harness PR must **re-stamp `NOW / NOW_DATE / WINDOW_START` and re-verify
baselines / prior-art / current-state** at its start.
