# RFC 0010 — Progressive tool disclosure (SEP-1888 alignment)

- **Status**: Stub (May 2026)
- **Author**: heznpc + Claude
- **Created**: 2026-05-07
- **Target**: v3.0.0 (after SEP-1888 lands)
- **Related**: [SEP-1888 — Progressive Disclosure](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888),
  [Skills-over-MCP charter](https://modelcontextprotocol.io/community/skills-over-mcp/charter),
  RFC 0007 (App Intent bridge), `npm run tokens` (PR #165), `discover_tools`, `compactDescription`

---

## 1. Motivation

AirMCP eagerly registers **269 tools** at session start. `npm run tokens` (PR #165) measured the description budget at ~3.8K tokens after `compactDescription` — already a 50% reduction over the raw 7.5K. The post-compaction number still puts a meaningful chunk of every model context into "things you might call" rather than "the thing the user asked for."

SEP-1888 (active May 2026) replaces "register N narrow tools" with a **progressive disclosure** pattern: the server exposes a small set of **library / namespace** tools with `searchTools` + `getTypes` operations. The model loads narrow tools on demand instead of seeing everything upfront. The Anthropic Skills-over-MCP charter calls out the same pattern as the long-term direction.

Why now (stub-only):
- SEP-1888 is **active** but not ratified. The exact tool shape may shift before GA.
- AirMCP's existing `discover_tools` already does most of the work — the gap is the discoverability *contract* (what the spec calls a "library tool"), not the search engine.
- Migrating 269 tools without a stable spec risks renaming the public surface twice.

This RFC parks the design space until SEP-1888 lands.

## 2. Goal

Reduce the **eager** tool surface to a single `airmcp.searchTools` library tool plus the destructive / always-relevant subset, deferring discovery of the rest to model-driven `searchTools` calls. Keep the existing `discover_tools` semantic search wiring as the implementation backend so search quality doesn't regress.

### Non-goals

- **Hide tools from `tools/list`.** Until SEP-1888 mandates a discovery shape, keeping eager exposure preserves compatibility with clients that don't speak progressive disclosure.
- **Re-architect the registry.** The internal `ToolRegistry` (PR #150 onwards) keeps every tool registered; only the *advertised* surface contracts.
- **Force-enable on all clients.** Capability-gated rollout — clients that advertise progressive-disclosure support get the slim surface; everyone else sees the full eager list.

## 3. Sketch

```
client capability advertises:
  capabilities.tools = { progressive: { version: "1.0" } }

→ server response to tools/list:
  [
    { name: "airmcp.searchTools",  description: "Find an AirMCP tool by intent." },
    { name: "airmcp.runTool",      description: "Run a tool returned from searchTools." },
    { name: "ai_agent",            description: "..." }     // always-relevant
    { name: "audit_log",           description: "..." }     // always-relevant (reflective)
    { name: "audit_summary",       description: "..." }
    // …~5-10 always-relevant tools, total
  ]
```

Inside `airmcp.searchTools`:
- Wraps the existing `discover_tools` semantic search
- Returns `{ name, description, inputSchema }` triples for the top-K matches
- Model then calls `airmcp.runTool({ name, args })` to invoke

Inside `airmcp.runTool`:
- Looks up via `ToolRegistry.callTool` (already exists for the skill executor)
- Routes through the same audit / OAuth / rate-limit / correlation-id wrapper

## 4. Open questions

1. **Where does the "always-relevant" boundary live?** Probably a per-tool `annotations.alwaysVisible: true` opt-in, defaulting false. Tools the model will always need (HITL helpers, reflection, ai_agent meta-tool) opt in.
2. **How does `tools/list` track when a session is in progressive mode?** Cache the negotiated capability per `Server` instance and pick the slim list at registration time. Re-running with `progressive: false` should reproduce today's behavior exactly.
3. **Schema versioning.** SEP-1888 may pin a wire format for the search result; align with that once stable.
4. **App Intents bridge (RFC 0007).** AppIntents are codegenerated from the eager manifest — Apple Spotlight / Siri don't read MCP, so they keep the full surface regardless of MCP-side progressive mode. No change needed.

## 5. Rollout plan (when SEP-1888 ratifies)

1. Implement `airmcp.searchTools` + `airmcp.runTool` library tools as zero-disruption opt-in (env: `AIRMCP_PROGRESSIVE_DISCLOSURE=true`)
2. Add `alwaysVisible` annotation to ~10 reflective / meta tools
3. Capability-gate the slim `tools/list` response
4. Re-run `npm run tokens` to quantify the eager-surface savings
5. Default-enable in v3.0.0 once two MCP clients (Claude Desktop + Cursor) negotiate the capability

## 6. Risk

- **Two-tool indirection cost.** Each tool call now becomes search → run, doubling round-trips for the model. Mitigation: cache search results client-side (model self-caching) and keep popular tools always-visible.
- **`discover_tools` quality regressions** become user-visible since search now drives every tool call instead of being optional. Existing semantic search test coverage needs strengthening before flipping the default.
