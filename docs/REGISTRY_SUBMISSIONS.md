# Registry Submissions — Status & Checklist

Internal tracking doc for AirMCP's public-registry presence. Update the status column on every change; use the checklist to prepare a resubmission.

## Status (as of 2026-04-20 — v2.10 prep)

| Registry | Status | Last action | Next step |
|---|---|---|---|
| **Anthropic MCP Registry** | Pending (submitted via Google Form, no response) | 2026-03-28 | Resubmit with v2.10 description (`server.json`) — registry schema now validates on the fly |
| **Smithery.ai** | Listed (`airmcp`) | Manifest auto-tracked via `smithery.yaml` | Request featured placement once v2.10 lands on npm |
| **Glama** | Listed (`AirMCP`) | `glama.json` present | Verify icon + category render on the live detail page |
| **MCP Market (mcpmarket.com)** | Not submitted | — | Submit after v2.10 with the README's "Beyond Siri" card set as the screenshot pitch |
| **Cline MCP Marketplace** | Not submitted | — | Low priority — distribution overlap with the above three |
| **PulseMCP** | Auto-indexed (GitHub crawl) | Passive | No action needed; listing follows the README metadata |

## Manifest files (keep in sync)

All four auto-sync via `npm run stats:sync` so the counts stay truthful on every merge:

- `server.json` — Anthropic MCP Registry (schema: `static.modelcontextprotocol.io/schemas/2025-12-11`)
- `mcp.json` — generic MCP client wiring snippet
- `glama.json` — Glama detail page
- `smithery.yaml` — Smithery submission

If you touch the tool/module count by hand, re-run `npm run stats:sync` before commit or CI's `stats:check` will fail.

## Resubmission checklist

When the counts or headline features change, walk this list before you touch any registry UI:

- [ ] `npm run stats:sync` shows **no** remaining diffs (zero "sync:" lines)
- [ ] `server.json` `version` matches `package.json` version
- [ ] `server.json` `description` reflects current headline features (skills / memory / audit / allowNetwork for v2.10)
- [ ] `README.md` Features block mirrors the description — catches the case where one was updated without the other
- [ ] `docs/index.html` hero + `tryit_footer` counts match the registry description
- [ ] `CHANGELOG.md` `[Unreleased]` block names every user-visible change since the last registry ping
- [ ] `npm run typecheck && npm test` — green before asking a reviewer to crawl the repo
- [ ] `git tag v<version>` pushed so the registry crawler has a pinned ref to point at

## Anthropic Registry — resubmission notes

The 2026-03-28 Google Form submission used the v2.7 pitch ("262 tools across 27 modules"). For the resubmission:

- **Headline for v2.10**: "MCP server for the entire Apple ecosystem — 269 tools across 29 modules with YAML skills, context memory, queryable audit log, and declarative HTTP network policy."
- **Security story** (registry reviewers care): HITL approval, rate limit + emergency stop file, `allowNetwork` startup invariant (RFC 0002), PII-scrubbed audit log at `0600`.
- **Differentiator vs. apple-mcp / shortcuts**: the Skills DSL (`parallel`/`loop`/`on_error`/`retry`/inputs/triggers) + the event-bus (9 triggers) — competitors don't ship automation primitives at all.
- **Demo asset**: point at `docs/demo.gif` (re-record with `./scripts/record-demo.sh` before the submission).

## Smithery — featured placement

Ask after the npm publish lands. Pitch the following concrete wins over the baseline `apple-mcp` listing:

- 18× tool count (15 → 269)
- Only Apple MCP with an **event-driven automation DSL** (skills + 9 triggers)
- Only Apple MCP with a queryable **audit log**
- Only Apple MCP with a documented **HTTP declarative security policy** (RFC 0002 in-tree)

The manifest is auto-synced; they shouldn't need any new asset from our side.
