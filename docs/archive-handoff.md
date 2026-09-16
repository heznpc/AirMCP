# AirMCP archive handoff

Prepared 2026-09-16 against remote main
`42003d1f16f52cde199303fcb909a6c8559a1bd9`.

Future product work is being consolidated in Taxi. Taxi's direction is to
route AI-initiated work to user-controlled computers and existing automation,
with explicit authority and observed results. MCP is one interface to that
execution layer. Taxi has no public release yet; this is not an instruction
to replace a working AirMCP installation with an unavailable package.

## Source and distribution

The latest published AirMCP release is **v2.16.5**. Maintenance changes merged
through [#482](https://github.com/heznpc/AirMCP/pull/482) are in source, including
Finder fixes, UI audit redaction, approval cancellation/timeout handling,
Podcasts compatibility, and test/CI improvements. They are **not** in v2.16.5.
The [maintenance ledger](maintenance-closeout.md) records the integration and
its validation limits. A source checkout and the published app/package must
not be presented as equivalent builds.

The tag `final-source/airmcp-v2.16.5` preserves Taxi's earlier source provenance
anchor. It is not a maintenance release and has not been moved to newer code.
Taxi does not automatically include all later AirMCP maintenance changes.

## Open records at preparation

- Finder issues [#459](https://github.com/heznpc/AirMCP/issues/459) and
  [#460](https://github.com/heznpc/AirMCP/issues/460) remain open. Their fixes are
  integrated in source; a published fix version has not been delivered.
- Dependency PRs [#483](https://github.com/heznpc/AirMCP/pull/483),
  [#485](https://github.com/heznpc/AirMCP/pull/485), and
  [#486](https://github.com/heznpc/AirMCP/pull/486) remain open. Archival would
  preserve these records without implying their changes were accepted.
- Existing tags, branches, worktree anchors, and contribution history remain.
  Archival is preservation, not a history rewrite or source deletion.

## Archive disposition

**Prepared; not yet archived.** The previous closeout plan calls for a verified
maintenance release and an available successor before archival. Neither is
established by this documentation change. The choice between that sequence
and archiving the current source/distribution with the limitations above must
be recorded here before marking the repository archived.

Repository archival, npm deprecation, and package removal are separate actions.
This handoff does not deprecate or remove existing packages or release assets.
