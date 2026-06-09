# RFC 0013 — Stratified review process for a broad codebase

- **Status**: Accepted (process) — referenced from `CONTRIBUTING.md`
- **Author**: heznpc + Claude
- **Created**: 2026-06-09
- **Relationship**: operationalizes the work-depth rule in `CLAUDE.md`; consumes RFC 0014 (scope tiers)

---

## 0. Why a flat review fails here

AirMCP is 29 modules / 272 tools + ~8.8K LOC of infra (`src/shared/` + `src/server/`)
+ 15.2K LOC of Swift bridge. A single diff-scan that treats all of that as equal
risk **dilutes max-effort review across surface that doesn't need it, and misses
the defects that actually matter.** The reason is that **blast radius is not
uniform**:

- A bug in a JXA tool (`create_note`, `play_track`) **fails loud** — one tool
  call errors, the model sees it, the user retries. Blast radius = one call.
- A bug in the **audit chain seal**, the **HITL gate**, the **OAuth verifier**, or
  the **rate-limit counter** is **silent and systemic** — it doesn't error, it
  quietly removes a safety property across *every* call. That is the class
  `/code-review` over a 272-tool diff is least likely to surface, because the
  reviewer's attention is spread over 271 low-stakes hunks.

So review effort must be **routed by risk**, not spread evenly. This RFC defines
the tiers, the routing, the per-area failure-mode catalog to hunt, the automated
floor that must hold underneath, and the cadence — including deep-auditing
*unchanged* critical code, which a diff-scan never re-reads.

## 1. Risk tiers

| Tier | What | Failure mode | Review depth |
|---|---|---|---|
| **T0 — Critical infra** | `src/shared/` audit (HMAC chain), HITL gate, rate-limit, OAuth verifier + scope gate, `allowNetwork` policy, tool-registry interceptor, structured-content validators, `esc`/JXA escaping; `src/server/` transport + boot invariants; the codegen *contract* (tool-manifest ↔ generated AppIntents ↔ runtime). | **Silent, systemic** — removes a safety property everywhere without erroring. | **Max** — `/code-review` at max effort on every diff + periodic deep audit of unchanged code (§5) + a behaviour-asserting contract test per invariant (§4). |
| **T1 — High-blast-radius surface** | `system` (27t), `ui` (10t), `finder`, `shortcuts` — the *agent-drives-the-Mac* surface — plus the HTTP transport. | **Loud but destructive** — a real action on the user's machine. | **High** — review + verify HITL coverage, `destructiveHint` annotations, scope-gate mapping, rate-limit tier (this is RFC 0014 §4.5). |
| **T2 — JXA-thin tool modules** | PIM + media + iWork modules (`notes`, `calendar`, `mail`, `music`, …). | **Fails loud, blast = 1 call.** | **Light** — the drift/contract tests are the floor; diff-review checks escaping + the `okUntrusted`/`toolError` shape, not deep logic. |
| **T3 — Generated / vendored** | `swift/.../Generated/`, lockfiles, `dist/`. | Wrong only if the *generator* is wrong. | **Review the generator + the drift guard, never the output.** |

The point of the tiers: when you invoke `/code-review`, **tell it the tier**, so
its effort matches the risk — "review this diff at T0 depth hunting the catalog
below," not "scan this 272-tool diff."

## 2. Failure-mode catalog (T0/T1 — what to actually hunt)

Generic "look for bugs" is what makes a broad scan shallow. Each critical area has
a *specific* defect class and the test that guards it:

| Area | Hunt for | Guarded by |
|---|---|---|
| Audit chain | seal/`_prev` mismatch, rotation re-anchor, genesis, tamper not detected | `audit-tamper-detection`, `audit-genesis-check`, `audit-rotation-resume`, `audit-recovery` |
| HITL gate | per-call bypass, batched "next N calls" regression, deny-on-unreachable | `hitl-client`, `hitl-guard`, `skills-hitl-queue` |
| Rate limit | off-by-one, reset-window drift, counter race | `rate-limit` |
| OAuth | alg confusion (`alg=none`/HS), scope-gate bypass, RFC 8707 audience, RFC 9728 PRM | `oauth-verifier`, `oauth-scope`, `well-known-card` |
| Network policy | SSRF, allowlist bypass, Origin 403, bind-all-without-token | `http-transport` |
| Tool-registry interceptor | wrapper not forwarding, re-entry/recursion, scope-gate not applied | `tool-registry`, `tool-registry-scope-gate` |
| JXA escaping | injection via `esc`/`escShell`/`escJxaShell`, prototype-pollution in Swift JSON reviver | `esc`, `jxa`, `jxa-scripts-ast` |
| outputSchema ↔ structuredContent | declared schema with no matching runtime payload → SDK validation error in prod | `output-schema-*` (8), `script-shape-contract` |
| Codegen contract | manifest ↔ AppIntents ↔ README drift; destructive-confirmation body | `codegen-destructive-dialog`, `codegen-helpers`; CI `gen:manifest:check` / `gen:intents:check` |
| Logger / banner | stdout pollution on stdio transport (must be stderr); ANSI on a pipe | `logger`; `banner` isTTY guard |

The standing memory rule applies on top: **ask "what does this test actually
verify" — registration-shape ≠ runtime-contract.** A test that only checks a tool
is *registered* is not a T0 guard.

## 3. Current floor (measured 2026-06-09)

T0 is, in fact, well-covered by behaviour tests — audit (6), HITL (3), OAuth (3),
network/transport (1), tool-registry (2), outputSchema (8), escaping (3), codegen
(3). The floor is real, not aspirational.

**Floor-fix #1 — CLOSED.** The **manifest ↔ doc drift guard**
(`tests/tool-count-drift.test.js`) was uncommitted and carried a false invariant
(README tool count `== manifest.toolCount`, i.e. 272 == 285 — unsatisfiable, since
the manifest is a superset incl. `skill_*` + MCP-app tools). It is now committed,
the assertion rewritten to the true superset relationship, and the stale
README sub-numbers (SnippetView 50→82, AppEnum 17→13) reconciled — so README ↔
manifest ↔ generated-Swift drift is caught on every CI run. The T0 floor now has
no known gap.

## 4. The automated floor is non-negotiable

Human review does not scale across a broad surface on re-scan — it gets tired and
skips. The durable guard is the **contract test**, and the rule is:

> Every T0 invariant has a test that asserts **behaviour** (the property holds
> under adversarial input), not registration metadata.

New T0 code without a behaviour test is a review-blocker. This is the mechanism
that lets human review *concentrate* on what tests can't express (cross-cutting
logic, new attack surface) instead of re-deriving covered properties every diff.

## 5. Cadence — audit the unchanged, too

Diff-scoped review (`/code-review` on a PR) is necessary but **structurally blind
to the worst defects**, which live in *unchanged* T0 code that no diff re-reads.
So:

- **Every PR**: `/code-review`, tier-tagged (§1). T0/T1 diffs at max/high depth.
- **Periodic (per minor release, or monthly)**: a **scheduled T0 deep audit** of
  the infra layer regardless of diffs — re-read `src/shared/` audit/HITL/OAuth/
  rate-limit/registry top to bottom against the §2 catalog. This is the pass that
  finds the silent-systemic defect a year of green diffs hid.
- **Floor maintenance**: any time a §2 guard is found missing or wrong (e.g. the
  drift test in §3), fixing it outranks new feature review.

## 6. How to invoke it — this is executable, not prose

The tiers + failure-mode catalog above are encoded in **`scripts/review-route.mjs`**,
so routing is mechanical, not a thing you remember to do:

- **`npm run review:route`** (or `node scripts/review-route.mjs --base <ref>`) —
  classifies the diff, prints each file's tier, the *specific* failure modes to
  hunt per touched T0/T1 area, the guard tests that must stay green, and a ⚠ for
  any T0 file changed without touching its guard test. `--json` drives tooling;
  `--check --strict` exits non-zero on an unguarded T0 change.
- **`npm run review:audit`** — the RFC §5 cadence: emits the full T0 deep-audit
  plan over *unchanged* infra, independent of any diff.
- **`/review`** (`.claude/commands/review.md`) — runs the router, then reviews at
  the routed depth instead of scanning uniformly.
- **CI** runs the router on every PR (informational step in `ci.yml`), so the
  tier plan + hunt list + unguarded-T0 warnings are visible on each change.

Keep `scripts/review-route.mjs`'s tier lists + catalog in sync with §1/§2 — when
a T0 invariant is added, add its row there *and* its behaviour test (§4).

## 7. Non-goals

- This does **not** mean less review overall — it means review *routed* so the
  silent-systemic class actually gets caught.
- It does **not** replace the contract-test floor with human review, or vice
  versa. The floor catches regressions on re-scan; humans catch the new and the
  cross-cutting. Both, routed by tier.
