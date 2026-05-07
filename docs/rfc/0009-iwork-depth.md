# RFC 0009 — iWork (Pages / Numbers / Keynote) coverage depth

- **Status**: Draft (May 2026)
- **Author**: heznpc + Claude
- **Created**: 2026-05-07
- **Target**: v2.13.0 (Phase 1 — read + structured edit) · v3.0.0 (Phase 2 — formula / template / chart codegen)
- **Related**: [`reichenbach/iwork_mcp` — 113 tools reference](https://github.com/reichenbach/iwork_mcp),
  [`easychen/keynote-mcp`](https://github.com/easychen/keynote-mcp),
  AirMCP `src/pages/`, `src/numbers/`, `src/keynote/`, RFC 0001 (error categories), RFC 0006 (Swift schema dump)

---

## 1. Motivation

May 2026 competitive scan found `reichenbach/iwork_mcp` shipping **113 tools** for Pages / Numbers / Keynote with charts, master slides, formula injection, batch ops, template discovery. AirMCP's iWork modules cover the basics (open / list / read / write title-and-body) but stop well short of "knowledge worker can actually replace their iWork workflow with MCP."

Three tiers of friction the gap creates:

1. **iWork power users will pick the specialist** for any task that touches structured data — Numbers cell formulas, Keynote master slide propagation, Pages section/style manipulation. AirMCP's "30+ Apple apps" pitch loses on depth.
2. **Apple Intelligence / Foundation Models on-device LLMs** can't drive iWork from natural language without rich tool affordances. The whole RFC 0007 "AppIntent bridge" thesis assumes the underlying tools cover the operations the user verbalizes.
3. **`iwork_mcp` is Python-based** — a TypeScript / JXA-native AirMCP equivalent is a real differentiator (no separate runtime, plugs into the existing audit / OAuth / rate-limit infrastructure).

## 2. Goal

Bring iWork coverage to **competitive parity** with `iwork_mcp` (~80% of its tool surface) within v2.13.0, then exceed it on the structured-edit + Apple Intelligence integration axis in v3.0.0.

### Non-goals

- Pages / Numbers / Keynote **rendering** (PDF / HTML preview). The Apple apps already render natively — AirMCP shouldn't reimplement.
- Cloud iWork (iCloud-only sync, browser editor). JXA can't reach those; out of scope.
- Replacing the iWork apps. AirMCP scripts the local apps; users still see the canonical UI.

## 3. Current state (May 2026)

| Module | Tool count | Coverage notes |
|--|--|--|
| `pages/` | TBD (audit at PR-time) | Open + read + likely body-set |
| `numbers/` | TBD | Open + table / cell minimal |
| `keynote/` | TBD | Open + slide list / append minimal |
| `iwork_mcp` (reference) | 113 | Tables, charts, formulas, master slides, batch ops, templates |

A pre-implementation audit (separate task) needs to count exactly what AirMCP ships today and produce a tool-by-tool gap matrix.

## 4. Phase 1 — read + structured edit (v2.13.0)

Targets **40-50 new tools** spanning the high-value workflows. Each module gets a focused sprint.

### 4.1 Numbers (highest demand)
- **Read**: `numbers_list_sheets`, `numbers_list_tables`, `numbers_read_cell_range`, `numbers_get_formula`, `numbers_list_charts`
- **Edit**: `numbers_set_cell`, `numbers_set_range` (CSV / 2D-array input), `numbers_set_formula`, `numbers_insert_row`, `numbers_insert_column`, `numbers_delete_row`, `numbers_delete_column`, `numbers_rename_sheet`
- **Structure**: `numbers_create_sheet`, `numbers_duplicate_sheet`, `numbers_create_table`, `numbers_resize_table`

### 4.2 Pages
- **Read**: `pages_get_section_count`, `pages_read_section`, `pages_list_styles`, `pages_get_word_count`, `pages_list_links`
- **Edit**: `pages_insert_section`, `pages_apply_style`, `pages_replace_text`, `pages_insert_image_at`, `pages_insert_table_at`
- **Structure**: `pages_set_page_break`, `pages_set_header`, `pages_set_footer`

### 4.3 Keynote
- **Read**: `keynote_list_master_slides`, `keynote_get_slide_layout`, `keynote_get_presenter_notes`, `keynote_list_transitions`
- **Edit**: `keynote_insert_slide_at`, `keynote_apply_master`, `keynote_set_slide_layout`, `keynote_set_presenter_notes`, `keynote_reorder_slides`, `keynote_duplicate_slide`
- **Structure**: `keynote_set_theme`, `keynote_set_slide_size`

### 4.4 Cross-cutting
- All new tools use the RFC 0001 typed error helpers (`errJxaFor`) — established in PR #173.
- Every tool registers an `outputSchema` for drift guards (Wave 5+ pattern from PR #158, #185).
- Per-app pollers for unsaved-state detection (Pages "modified" indicator) folded into the existing `pollers.ts` infrastructure.

## 5. Phase 2 — Formula codegen / template introspection (v3.0.0)

- **Numbers formula generation** — natural-language → Numbers formula compiler. Hooks into Apple Intelligence Foundation Models for on-device translation.
- **Keynote master propagation** — apply a layout / theme change across every slide that uses a given master. Requires walking the master-detail relationship via JXA.
- **Pages template introspection** — list Apple-bundled templates + extract style / layout metadata so a user can clone style without copy-paste.
- **Chart manipulation** — read / set chart data, type, series labels. Highest JXA complexity; deferred behind everything else.

## 6. Risks

1. **JXA scripting dictionary inconsistency** — Apple's iWork apps have notoriously partial AppleScript dictionaries. Each tool needs a JXA reachability probe in `airmcp doctor`.
2. **Performance on large spreadsheets** — `numbers_read_cell_range` on a 10K-row table via JXA is slow. Phase 1 caps range size at 1000 cells; Phase 2 might need a Swift bridge fast path via `iWorkKit` if Apple ever exposes one.
3. **Discoverability bloat** — adding 40+ tools doubles the iWork manifest. Compact descriptions (RFC 0007 §A.0) + tool grouping in `discover_tools` already mitigate; will need to re-run `npm run tokens` (PR #165) to confirm context budget.

## 7. Rollout plan

1. **Audit PR** — count current `pages/`, `numbers/`, `keynote/` tools; produce a gap matrix versus `iwork_mcp`.
2. **Numbers sprint** — 17 new tools (§4.1) in 3-4 PRs grouped by surface (read / edit / structure).
3. **Pages sprint** — 13 new tools (§4.2).
4. **Keynote sprint** — 13 new tools (§4.3).
5. **Phase 2 RFC** — separate document once Phase 1 lands and we've measured token-budget impact.

Each sprint follows the established AirMCP pattern: feature flag → RFC 0001 typed errors → outputSchema drift guards → audit / OAuth / rate-limit gates inherit automatically.
