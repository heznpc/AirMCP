---
description: Stratified code review routed by risk tier (RFC 0013/0014) — not a flat scan
---

Run a **risk-tier-routed** review of the current changes, per
`docs/rfc/0013-review-process.md`. A flat scan over 272 tools dilutes attention
and misses the silent-systemic defects (audit seal / HITL bypass / OAuth /
rate-limit) that actually matter. Route effort to blast radius instead.

## Step 1 — get the routing plan (don't skip; this is the mechanism)

Run the executable router and read its output:

```
node scripts/review-route.mjs --base "${ARGUMENTS:-origin/main}"
```

It prints, for the diff: each changed file's **tier**, the **failure modes to
hunt** per touched T0/T1 area, the **guard tests** that must stay green, and a
**⚠ warning** for any T0 file changed without touching its guard test.

(For a periodic audit of *unchanged* infra — RFC 0013 §5 — run
`node scripts/review-route.mjs --audit` instead and review every T0 area.)

## Step 2 — review at the routed depth, NOT uniformly

- **T0 (critical infra)** — review at MAX depth. For each touched area, hunt the
  *specific* failure mode the router named (e.g. audit → seal/_prev mismatch +
  tamper-not-detected; OAuth → alg=none/HS confusion + scope bypass). A generic
  "looks fine" is not a T0 review. Confirm the named guard tests cover the change;
  if a T0 file changed with no guard-test change, treat closing that gap as
  higher priority than the feature itself.
- **T1 (system / ui / finder / shortcuts)** — the agent-drives-the-Mac surface.
  Verify HITL coverage, `destructiveHint` annotations, scope-gate mapping, and
  rate-limit tier (RFC 0014 §4.5).
- **T2 (JXA-thin modules)** — light. Check `esc()`/escaping, the
  `okUntrusted`/`toolError` result shape, and that the contract test still passes.
  Don't spend max effort here; it fails loud, blast radius is one call.
- **T3 (generated / vendored)** — review the **generator** (e.g.
  `scripts/gen-swift-intents.mjs`) and the drift guard, never the generated
  output.

## Step 3 — report

Lead with the **highest tier touched** and the T0/T1 findings against the hunt
list. Note any unguarded-T0 gap explicitly. Keep T2/T3 to a line unless the
contract tests fail.
