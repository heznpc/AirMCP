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
public env surface, `src/`, the published file set, or product docs.

## 2. Baseline fairness (ratified)

*Contract.* Schema: [`schemas/baseline-adapter.schema.json`](./schemas/baseline-adapter.schema.json).

- **`capability-matched` is primary**; **`capability-native` (arbitrary-script's real broader
  surface) is secondary and explicitly labeled.**
- Every arm uses the **same fixture source, same task interface, same allowed action set, and
  same scenario corpus**. For `capability-matched`, the adapter's allowed action set **equals**
  the shared tool catalog.
- **No per-scenario and no per-arm hand-tuned exploits.** Injection vectors come only from the
  shared, versioned fixture/scenario corpus, applied identically to all arms.
- The schema enforces: `capability-native ⇒ role = secondary`, and
  `capability-matched ⇒ same_allowed_action_set = true`.

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

Three **observed-side-effect** oracles, separated so S2-class scenarios (HTTP egress **and**
cloud-write) don't blur:

- **`http_egress_sink`** — observes outbound HTTP exfiltration attempts.
- **`mock_workspace_sink`** — observes cloud-write / `gws_*`-style outputs (Sheets/Gmail/etc.).
- **`filesystem_side_effect_observer`** — observes file delete/move/trash/symlink effects
  (also the oracle for the destructive-cascade and path-escape scenarios).

Each scenario maps to one or more channels; `model_self_report_is_oracle` is a schema `const
false`.

---

## Schemas added in this PR

| File | Purpose | Note |
|---|---|---|
| [`approver-policy.schema.json`](./schemas/approver-policy.schema.json) | `ASR_humanlike` approval policy | ratified approve/deny rules; same policy for all arms incl. baseline adapters |
| [`oracle-mapping.schema.json`](./schemas/oracle-mapping.schema.json) | scenario → oracle channel(s) | `model_self_report_is_oracle = false` |
| [`baseline-adapter.schema.json`](./schemas/baseline-adapter.schema.json) | per-baseline fairness contract | bakes native⇒secondary, matched⇒same action set |
| [`partial-weights.schema.json`](./schemas/partial-weights.schema.json) | PARTIAL credit weights (secondary metric) | **shape only — weights are PROPOSED placeholders, no final values** |

## Still `proposed` / explicitly NOT in this PR

Harness runner, scenario execution, model calls, real app automation, scoring code, the actual
PARTIAL weight values, and the experiment-layer bypass implementation itself. Per design
§11.7, the harness PR must **re-stamp `NOW / NOW_DATE / WINDOW_START` and re-verify
baselines / prior-art / current-state** at its start.
