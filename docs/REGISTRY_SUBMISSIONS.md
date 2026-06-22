# Registry Submissions — Status & Checklist

Internal tracking doc for AirMCP's public-registry presence. Update the status column on every change; use the checklist to prepare a resubmission.

## Status (as of 2026-04-24 — v2.11.0 shipped · OAuth 2.1 + `.mcpb` + notarize live)

| Registry                       | Status                                           | Last action                               | Next step                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic MCP Registry**     | Pending (submitted via Google Form, no response) | 2026-03-28                                | **Resubmit now** with the current description below — new differentiators: `.mcpb` one-click install, OAuth 2.1 + Resource Indicators, notarized macOS app, 228 AppIntents    |
| **Smithery.ai**                | Listed (`airmcp`)                                | Manifest auto-tracked via `smithery.yaml` | Request featured placement — current pitch should be workflow + governance depth, bounded to README-level Apple-native comparisons rather than an unqualified "only" claim     |
| **Glama**                      | Listed (`AirMCP`)                                | `glama.json` present                      | Verify icon + category render on the live detail page; ask for category "Apple / macOS" pin                                                                                 |
| **MCP Market (mcpmarket.com)** | Not submitted                                    | —                                         | **Submit this week** — see section below for the pitch (v2.11 headline)                                                                                                     |
| **Cline MCP Marketplace**      | Not submitted                                    | —                                         | Low priority — distribution overlap with the above three                                                                                                                    |
| **PulseMCP**                   | Auto-indexed (GitHub crawl)                      | Passive                                   | No action needed; listing follows the README metadata                                                                                                                       |
| **Claude Desktop Extensions directory** | `.mcpb` bundle built (v2.11)           | 2026-04-24                                | **Submit now** via Anthropic's review path — first Apple-native `.mcpb` submission opportunity                                                                              |
| **cursor.directory**           | Not submitted                                    | —                                         | Submit via cursor.directory/submit (free listing). Cursor is a major MCP client — direct visibility to dev users                                                            |
| **MCP.so**                     | Not submitted                                    | —                                         | Submit via mcp.so/submit form. High-traffic aggregator (60k+ monthly visits Q1 2026)                                                                                        |
| **mcphub.io**                  | Not submitted                                    | —                                         | Submit via mcphub.io/submit. EU-leaning audience; OAuth 2.1 + Resource Indicators is a fit                                                                                   |
| **Modelo MCP Hub**             | Not submitted                                    | —                                         | Submit via app.modelo.ai/mcp/submit. New (Q1 2026) but aggressive growth; pitch the iOS angle                                                                               |
| **mcpservers.org**             | Not submitted                                    | —                                         | Submit via PR to github.com/punkpeye/awesome-mcp-servers (mirrors here)                                                                                                     |
| **awesome-mcp-servers (GitHub list)** | Not submitted                             | —                                         | PR to add AirMCP under "Apple ecosystem" or new "macOS/iOS" category                                                                                                        |
| **LobeHub MCP Marketplace**    | Not submitted                                    | —                                         | Submit via lobehub.com/mcp/new. Korean + Chinese audience; relevant for AirMCP's Korean dev base                                                                            |
| **MCP Index (mcpindex.net)**   | Not submitted                                    | —                                         | Submit via form. Smaller but well-curated; faster review                                                                                                                    |
| **Composio MCP Hub**           | Not submitted                                    | —                                         | Submit via composio.dev/mcp. Enterprise-leaning — pitch OAuth 2.1 + RFC 8707                                                                                                 |
| **HyperMCP**                   | Not submitted                                    | —                                         | Submit via hypermcp.io. Devtools-focused                                                                                                                                     |
| **MCP Discover (mcpdiscover.com)** | Not submitted                                | —                                         | Submit via discover form. Community-curated                                                                                                                                  |
| **FastMCP Cloud**              | Not applicable                                   | —                                         | FastMCP-flavored hosting. AirMCP isn't FastMCP-built — skip                                                                                                                  |

> 19 directories tracked total. **First wave (this sprint)**: Anthropic resubmit + cursor.directory + MCP.so + mcphub.io + awesome-mcp-servers. The rest cascade after those 5 land.

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
- [ ] `server.json` `description` reflects current headline features (`.mcpb` one-click, OAuth 2.1, notarized app, 228 AppIntents, skills, memory, audit, inbound HTTP `allowNetwork`)
- [ ] `README.md` Features block mirrors the description — catches the case where one was updated without the other
- [ ] `docs/index.html` hero + `tryit_footer` counts match the registry description
- [ ] `CHANGELOG.md` `[Unreleased]` block names every user-visible change since the last registry ping
- [ ] `npm run typecheck && npm test` — green before asking a reviewer to crawl the repo
- [ ] `git tag v<version>` pushed so the registry crawler has a pinned ref to point at

## Anthropic Registry — resubmission notes

The 2026-03-28 Google Form submission used the v2.7 pitch ("262 tools across 27 modules"). For the resubmission:

- **Headline for current resubmission**: "MCP server for the entire Apple ecosystem — 286 tools across 29 modules with workflow skills, context memory, queryable audit log, sensitive-action HITL, OAuth 2.1, and inbound HTTP `allowNetwork` policy."
- **Security story** (registry reviewers care): HITL approval, rate limit + emergency stop file, `allowNetwork` startup invariant (RFC 0002), PII-scrubbed audit log at `0600`.
- **Differentiator vs. apple-mcp / shortcuts**: the Skills DSL (`parallel`/`loop`/`on_error`/`retry`/inputs/triggers) + event-bus triggers + governance primitives. Keep this claim bounded: based on README-level/public-surface comparison, not full source audits of every competitor.
- **Demo asset**: point at `docs/demo.gif` (re-record with `./scripts/record-demo.sh` before the submission).

## Smithery — featured placement

Ask after the npm publish lands. Pitch the following concrete wins over the baseline `apple-mcp` listing:

- Broad tool surface plus workflow-first entry points (286 tools, 29 modules, curated workflow catalog)
- README-level Apple-native comparison: AirMCP is the only tracked listing that publicly documents the full governance stack together — HMAC audit, sensitive-action HITL, rate limit, inbound HTTP `allowNetwork`, OAuth Resource Indicators
- Queryable audit log and Skills DSL are concrete differentiators; avoid claiming competitors have zero governance without a fresh source audit
- Documented inbound HTTP exposure policy (RFC 0002 in-tree)

The manifest is auto-synced; they shouldn't need any new asset from our side.

## MCP Market (mcpmarket.com) — first submission

One-paragraph pitch for the submission form:

> AirMCP is an Apple-native MCP runtime for governed workflows across the local Apple workspace. It ships 286 tools across 29 modules (Notes, Calendar, Reminders, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Apple Intelligence previews, TV, Screen Capture, Maps, Podcasts, Weather, Pages/Numbers/Keynote, Location, Bluetooth, HealthKit, Context Memory, Audit), plus workflow skills, sensitive-action HITL approval, HMAC-chained audit logs, rate limiting, OAuth 2.1 + Resource Indicators, and an inbound HTTP `allowNetwork` policy (RFC 0002). In README-level Apple-native MCP comparisons, this is the full-stack governance surface to beat; re-check competitor READMEs/source before publishing any unqualified "only" claim. Open source (MIT), v2.12+ on npm. iOS sibling with auto-generated AppIntents and an opt-in Foundation Models on-device agent preview (RFC 0007) in active development.

Screenshots to attach:

- `docs/screenshots/beyond-siri-cards.png` (the landing page's five-card pitch)
- Terminal with `npx airmcp doctor` showing module status

## Axis tracker (iOS roadmap)

Registry descriptions should cite the iOS work cumulatively as it lands. Update here when each of these merges so the next resubmission inherits the mention:

- [x] RFC 0007 accepted + `AirMCPKit` shared Swift package — macOS/iOS
- [x] Tool manifest codegen + 154 auto-generated Siri/Shortcuts/Spotlight AppIntents (PR #101–#105)
- [x] `MCPIntentRouter` runtime on macOS (execFile) + iOS (in-process) — PR #103
- [x] Codable drift guards (50 typed output structs) — PR #106
- [x] `AskAirMCPIntent` on-device Foundation Models agent — PR #107; preview-only behind `AIRMCP_ENABLE_FOUNDATION_MODELS`
- [x] App Store submission assets + Privacy Manifest — PR #108 (this sweep)
- [ ] Interactive Snippets renderer (axis 4)
- [ ] Destructive-tool HITL via `requestConfirmation` (A.3)
