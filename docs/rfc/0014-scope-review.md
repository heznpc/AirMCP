# RFC 0014 — Tool-surface scope review (post-WWDC 2026)

- **Status**: Accepted (review framework) — per-item actions tracked in §4
- **Author**: heznpc + Claude + Codex
- **Created**: 2026-06-09
- **Relationship**: depends on RFC 0011 (post-WWDC verdict); feeds RFC 0004 (compat matrix)

---

## 0. The question, and the honest answer

"AirMCP's code scope is too broad — did WWDC 2026 make any of it removable?"

**Almost none of it.** WWDC strengthened Siri + App Intents, but that is the
**consumer/Siri surface**. AirMCP opens the *same* Apple action catalog to a
**different consumer** — Claude, Codex, Cursor, Gemini CLI, Xcode 27 agents, any
MCP-capable client — as a governed MCP runtime (RFC 0011 §0.1, the two-layer
correction). Apple doing a thing for Siri does not make AirMCP's tool redundant
for every *non-Siri* agent. So "WWDC made X removable" is the wrong frame.

The real scope levers are **not width** — they are:
1. **Rotten substrate** — JXA bridges Apple broke on a macOS release.
2. **Broken contracts** — individual tools that no longer work.
3. **Better native substrate** — places where an Apple API now beats JXA
   (refactor, *not* removal).

This deliberately does **not** reopen the standing philosophy in
`CLAUDE.md` / the registry: *"the tool surface is broad and JXA-thin by design;
module-count growth is additive, gated by macOS version, not architectural
debt."* Width stays intentional. What this RFC cuts is rot, not breadth.

## 1. Review rubric — five axes per module

Score each module on these; the reds sort keep/cut. Usage is owner-supplied
(the repo has no telemetry; pull it from `usageTracker` data on your machine).

| Axis | Question | Red signal |
|---|---|---|
| **Health** | Works on current macOS (26)? | `brokenOn: [26]`, Full Disk Access blocked |
| **Differentiation** | Value in the infra layer (governance / workflow / multi-client) or a thin JXA passthrough? | no HITL/audit/workflow tie-in, one-shot wrapper |
| **WWDC substrate** | Is there now a better Apple-native API (App Intents / App Schemas / Core AI) than the JXA path? | JXA is the only path *and* a native replacement exists |
| **Maintenance** | LOC × JXA fragility × per-macOS churn | high LOC that breaks every macOS bump |
| **Usage** | Is it actually invoked? | 0 calls in telemetry |

**The decisive test:** *"Now that Siri does the one-shot version natively, does
this tool's value survive?"* What survives is **multi-client + cross-module
workflow + governance**. A thin wrapper with none of those is the weakest — but
"weak" means *re-evaluate*, not *auto-delete* (see §5).

## 2. Inventory (measured 2026-06-09)

29 tool modules / 272 tools. Infra (the differentiated layer) = `src/shared/`
7,064 LOC + `src/server/` 1,717 LOC. Swift bridge = 15,173 LOC (single largest:
EventKit / HealthKit / PhotoKit / Vision / FoundationModels). Tool modules are
mostly JXA-thin.

Largest tool modules: `system` (27), `music` (17), `google` (16),
`intelligence` (13, macOS-26 gated), `safari` (12), `notes` (12), `ui` (10).

Known rot: `safari` `brokenOn: [26]` but module status **stable** — only
`add_bookmark` + bookmark/reading-list scripting died (Apple removed the JXA
bookmark classes in macOS 26; see `src/shared/modules.ts`). `podcasts`
**deprecated + brokenOn 26**, removal already scheduled for v3.0.0 (JXA
dictionary removed entirely).

## 3. Triage

| Bucket | Modules | Basis |
|---|---|---|
| **Defensible cut (rot)** | `podcasts` (6t) — full; `safari` (12t) — **`add_bookmark` only** | Broken on macOS 26. `podcasts` already deprecated. `safari` module stays — tab/page/navigation/URL/reading still serve agent workflows; only the bookmark-write contract is dead. WWDC-independent. |
| **Substrate refactor (not removal)** | `intelligence` (13t/1149L) → Core AI + Foundation Models (image input, Dynamic Profiles); iWork `pages`/`numbers`/`keynote` (28t) → track for a native/scriptable API beating JXA | Swap fragile JXA for Apple-blessed native where it now exists. Scope is *unchanged*; substrate improves. |
| **Watch — decide by usage only** | `tv` (6t), `speech` (3t), `weather` (3t), `location` (2t), `bluetooth` (4t) | Thin + OS/Siri provides a base version. If telemetry shows ~0 calls *and* no workflow tie-in, candidate to demote; otherwise keep. **No cut without usage data.** |
| **Core keep** | PIM (`notes`/`calendar`/`reminders`/`mail`/`contacts`/`photos`), `system` (27t), `ui` (10t), `google` (16t — WWDC-irrelevant), `memory`/`semantic`/`audit`/`skills` (= the differentiation layer), Swift bridge | Multi-client + cross-module + governance value survives Siri. `system`/`ui` are the *agent-controls-the-Mac* surface — **higher governance value, not deletion** (§4.5). |

## 4. Ordered actions

1. **`podcasts` → confirmed v3.0 removal.** Already `deprecated` + `brokenOn 26`.
   Keep returning the clear error until the v3.0 cut; no new investment.
2. **`safari` → per-tool, not module.** Deprecate/remove `add_bookmark` (dead
   JXA `make new bookmark`); keep tab/page/navigation/reading/URL tools. Update
   the module's tool list + README Platform Constraints, not the module gate.
3. **Watch bucket → usage-gated.** `tv`/`speech`/`weather`/`location`/`bluetooth`
   decided *only* against owner telemetry. Don't touch on intuition.
4. **`intelligence` → separate Core AI migration RFC** (gated on WWDC sessions
   324/325/326 publishing + first-party Core AI docs). Refactor, not cut.
5. **`system` / `ui` → risk-tier review, not deletion.** These are the highest-
   blast-radius surface (an agent driving the whole Mac). The right move is
   *stronger* gating — confirm HITL coverage, destructive-hint annotations,
   rate-limit tiers, scope-gate mapping — so the governance layer that *is*
   AirMCP's value is fully applied here. Tracked against RFC 0007 (destructive
   confirmation) + the rate-limit/scope model.

## 5. What this RFC does NOT do

- It does **not** narrow the tool surface as a goal. Width is intentional
  (CLAUDE.md non-goal). The targets are rot and broken contracts, full stop.
- It does **not** delete anything on intuition. Only `add_bookmark` (provably
  dead) and `podcasts` (already deprecated) are cut without telemetry; the
  Watch bucket waits for usage data.
- It does **not** treat `system`/`ui`/`music`/`shortcuts` as "shallow wrapper
  cut candidates." That earlier framing was too broad — those are agent-control
  surfaces whose value appears the moment governance attaches.
