# Registry Submissions — Status & Checklist

Internal tracking doc for AirMCP's public-registry presence. Update the status column on every change; use the checklist to prepare a resubmission.

## Status (as of 2026-04-24 — v2.11.0 shipped · OAuth 2.1 + `.mcpb` + notarize live)

| Registry                       | Status                                           | Last action                               | Next step                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic MCP Registry**     | Pending (submitted via Google Form, no response) | 2026-03-28                                | **Resubmit now** with the v2.11 description below — new differentiators: `.mcpb` one-click install, OAuth 2.1 + Resource Indicators, notarized macOS app, 229 AppIntents    |
| **Smithery.ai**                | Listed (`airmcp`)                                | Manifest auto-tracked via `smithery.yaml` | Request featured placement — v2.11 adds `.mcpb` + OAuth so the "only Apple-native production-grade MCP" angle is stronger than at v2.10                                     |
| **Glama**                      | Listed (`AirMCP`)                                | `glama.json` present                      | Verify icon + category render on the live detail page; ask for category "Apple / macOS" pin                                                                                 |
| **MCP Market (mcpmarket.com)** | Not submitted                                    | —                                         | **Submit this week** — see section below for the pitch (v2.11 headline)                                                                                                     |
| **Cline MCP Marketplace**      | Not submitted                                    | —                                         | Low priority — distribution overlap with the above three                                                                                                                    |
| **PulseMCP**                   | Auto-indexed (GitHub crawl)                      | Passive                                   | No action needed; listing follows the README metadata                                                                                                                       |
| **Claude Desktop Extensions directory** | `.mcpb` bundle built (v2.11)           | 2026-04-24                                | **Submit now** via Anthropic's review path — first Apple-native `.mcpb` submission opportunity                                                                              |

### 2026-04-23 research recap (use in every submission)

- [Best MCP for Mac, 2026 survey](https://www.local-mcp.com/guides/best-mcp-server-mac): _"Outside the archived apple-mcp, no implementation exceeds 5 stars. Most have single-digit commits and single contributors."_
- `supermemoryai/apple-mcp` archived 2026-01-01 with 3.1k stars, zero further updates.
- Apple has **not** released an official iCloud MCP; Google, Dropbox, Microsoft have.
- MCP ecosystem: 97M monthly SDK installs (Mar 2026), 10,000+ public servers; Gartner expects 75% of API gateway vendors to ship MCP support by end of 2026.

These numbers belong in every submission blurb — they explain _why now_.

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
- [ ] `server.json` `description` reflects current headline features (v2.11: `.mcpb` one-click, OAuth 2.1, notarized app, 229 AppIntents, skills, memory, audit, allowNetwork)
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

## MCP Market (mcpmarket.com) — first submission

One-paragraph pitch for the submission form:

> AirMCP is the only production-grade Apple-native MCP server still actively shipping after supermemoryai/apple-mcp was archived in January 2026. 269 tools across 29 modules (Notes, Calendar, Reminders, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Apple Intelligence, TV, Screen Capture, Maps, Podcasts, Weather, Pages/Numbers/Keynote, Location, Bluetooth, HealthKit, Context Memory, Audit) with a Skills DSL (parallel/loop/retry/event triggers), HITL approval, queryable audit log, rate limiting, and a declarative HTTP network policy (RFC 0002). Open source (MIT), v2.10 on npm. iOS sibling with 154 auto-generated AppIntents + Foundation Models on-device agent (RFC 0007) in active development.

Screenshots to attach:

- `docs/screenshots/beyond-siri-cards.png` (the landing page's five-card pitch)
- Terminal with `npx airmcp doctor` showing module status

## Axis tracker (iOS roadmap)

Registry descriptions should cite the iOS work cumulatively as it lands. Update here when each of these merges so the next resubmission inherits the mention:

- [x] RFC 0007 accepted + `AirMCPKit` shared Swift package — macOS/iOS
- [x] Tool manifest codegen + 154 auto-generated Siri/Shortcuts/Spotlight AppIntents (PR #101–#105)
- [x] `MCPIntentRouter` runtime on macOS (execFile) + iOS (in-process) — PR #103
- [x] Codable drift guards (50 typed output structs) — PR #106
- [x] `AskAirMCPIntent` on-device Foundation Models agent — PR #107
- [x] App Store submission assets + Privacy Manifest — PR #108 (this sweep)
- [ ] Interactive Snippets renderer (axis 4)
- [ ] Destructive-tool HITL via `requestConfirmation` (A.3)
