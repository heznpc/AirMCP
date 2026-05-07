# RFC 0008 — MCP Elicitation for destructive tools

- **Status**: Draft (May 2026)
- **Author**: heznpc + Claude
- **Created**: 2026-05-07
- **Target**: v2.13.0 (Phase 1 — confirmation prompts) · v3.0.0 (Phase 2 — form/URL elicit)
- **Related**: [`@modelcontextprotocol/sdk` 1.29.0 elicitInput API](https://github.com/modelcontextprotocol/typescript-sdk),
  [MCP Elicitation spec (draft)](https://modelcontextprotocol.io/specification/draft/client/elicitation),
  [GitHub Copilot blog — MCP elicitation](https://github.blog/ai-and-ml/github-copilot/building-smarter-interactions-with-mcp-elicitation-from-clunky-tool-calls-to-seamless-user-experiences/),
  RFC 0001 (error categories), RFC 0007 (App Intent bridge — destructive HITL)

---

## 1. Motivation

Destructive AirMCP tools (`delete_*`, `bulk_move_*`, `send_*`, `quit_app`, `system_power`) currently fall back to one of two patterns:

1. **HITL guard via macOS confirmation dialog** (`requestConfirmation` from RFC 0007 §A.3). Works inside Apple App Intents / Shortcuts / Siri but invisible to plain MCP clients (Claude Desktop, Cursor, Windsurf).
2. **No prompt at all** — the model has to decide "should I delete?" on its own. With OAuth `mcp:destructive` scope (RFC 0005) and rate-limit buckets (PR #159) we cap blast radius, but the per-call decision is still on the LLM.

MCP Elicitation (June 2025 spec, mature in 2026) standardizes a **server-driven, mid-tool-call user prompt**. The server pauses, sends `elicitation/create` to the client, the client renders the form, the user responds, the server resumes. Effectively the same UX HITL gives App Intents, but over the MCP wire so Claude Desktop / Cursor / etc. can render it natively.

Result of the existing `iwork_mcp` survey + Anthropic SDK 1.29.0 inspection:
- Server SDK already exposes `server.elicitInput(params, options)` returning an `ElicitResult`.
- Two modes: **form** (schema-described inputs) and **URL** (out-of-band browser flow).
- Client capability advertised in the `initialize` handshake — clients that don't support elicitation reject the request with a known error code.

## 2. Goal

Wrap every tool whose `annotations.destructiveHint = true` with a **confirmation elicit** that fires automatically when the client supports elicitation, falls back to the existing HITL guard when it doesn't, and never blocks tools that aren't destructive.

### Non-goals (Phase 1)

- Form-based parameter capture (e.g. "ask the user for the new note title before creating it"). Kept for Phase 2 — Phase 1 is binary confirm / cancel only.
- URL-based elicitation (OAuth-style consent flows). Out of scope until a tool actually needs it.
- Custom elicitation surfaces inside App Intents (Apple's `requestConfirmation` already covers that path; keep RFC 0007 §A.3 verbatim).

## 3. Design

### 3.1 Wrapper placement

```
ToolRegistry.wrapHandler
  ├── usage tracker
  ├── correlation-id stamp           (PR #190)
  ├── OAuth scope gate                (RFC 0005 §3.4)
  ├── rate-limit gate                 (per-tenant, PR #159)
  ├── ⭑ elicitation gate (NEW)        ── Phase 1 ──
  ├── HITL guard (App Intents only)   (RFC 0007 §A.3)
  └── execute(handler)
```

The elicit gate runs **after** OAuth + rate-limit (so a denied call doesn't surface a UI prompt) and **before** the handler (so a cancellation prevents side effects).

### 3.2 Capability detection

```ts
// At handler entry, peek at the active server's negotiated capabilities.
const supportsElicit = server.getClientCapabilities()?.elicitation != null;
if (entry?.destructive && supportsElicit) {
  const decision = await server.elicitInput({
    mode: "form",
    title: `Confirm: ${entry.title ?? name}`,
    schema: { type: "boolean", description: `Run \`${name}\` with the supplied arguments?` },
    elicitationId: getCorrelationId() ?? randomUUID(),
  });
  if (decision.kind === "cancel" || decision.value !== true) {
    auditLog({ tool: name, status: "error", correlationId: getCorrelationId(), args: { _hitl_cancelled: true } });
    throw new Error(`[hitl_cancelled] User declined ${name}`);
  }
}
```

Cancellation = audit "error" + RFC 0001 `hitl_timeout` category (re-purposed: same shape, different cause).

### 3.3 Backwards compatibility

| Client capability | macOS surface | Behavior |
|--|--|--|
| Elicitation supported | Any | New elicit prompt before call |
| Elicitation **not** supported | App Intents (Shortcuts/Siri/Spotlight) | RFC 0007 §A.3 `requestConfirmation` (existing) |
| Elicitation **not** supported | HTTP / stdio | No prompt — rate-limit + scope gate are the only safety net (today's behavior) |

`AIRMCP_ELICITATION_DISABLE=true` env opt-out for users who script destructive tools end-to-end and don't want UI prompts.

### 3.4 Audit + correlation-id

Every elicit decision logs an audit entry threaded by the call's `correlationId` (from PR #190): the original tool call entry, the elicit decision, and any error all carry the same ID so log analysis is one `grep`.

## 4. Phase 2 (deferred to v3.0.0)

- **Form mode** — capture missing required params instead of returning an `errInvalidInput`. Useful for `create_event(summary)` when the LLM forgot to supply `summary`.
- **URL mode** — OAuth-style consent flows for tools that touch personal data (e.g. `health_*` requesting fresh authorization).
- **Capability-driven affordances** — surface "this tool will ask for confirmation" in `tools/list` so the model knows ahead of time. Requires a new field in the MCP tool description SEP.

## 5. Open questions

1. **Should the prompt show the args?** Defaults to "yes, sanitized via `sanitizeArgs`" — same path the audit log uses. Skipping args risks the user approving the wrong action.
2. **Should AppIntent calls also route through the elicit gate?** Currently no — App Intents have native confirmations. Doubling up creates dialog fatigue. Re-evaluate when Apple ships system MCP and the `requestConfirmation` API may merge with elicitation.
3. **Cancellation taxonomy** — do we need a distinct `cancelled` category in RFC 0001, separate from `hitl_timeout`? Probably yes; user cancel is a different signal than client-side timeout.

## 6. Rollout plan

1. **Phase 1.0** — `elicitInput` wrapper for destructive tools, capability-gated, env-opt-out. Unit tests against an in-process MCP test client that supports elicitation.
2. **Phase 1.1** — Audit log integration (correlationId thread).
3. **Phase 1.2** — Doctor / `audit_summary` surfaces "elicit cancelled" stats.
4. **Phase 2** — Form/URL modes (separate RFC, post-v3.0.0).
