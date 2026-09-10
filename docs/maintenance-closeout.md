# AirMCP maintenance closeout

Snapshot: 2026-09-11. This ledger separates source integration from published
releases. The registry's current `airmcp@latest` is **2.16.5**; the maintenance
changes below are not included in that published version.

## Preserved source

The remote tag [`final-source/airmcp-v2.16.5`](https://github.com/heznpc/AirMCP/tree/final-source/airmcp-v2.16.5)
preserves `6e85de94ee71011c2ac318adeabfa5d43bde50b2`. It is a source-provenance
anchor, not a new release tag. Subsequent maintenance must not move it.

## Maintenance integration

The integration branch is `chore/airmcp-maintenance-closeout`, based on main
`cceaab9cbe1614151af405f5e2f6372dac616fc1`. Original PR commits are retained with
merge commits so contribution history and source ancestry survive integration.

| PR | Change | Disposition |
| --- | --- | --- |
| [#461](https://github.com/heznpc/AirMCP/pull/461) | Redact UI input in audit rows and previews | Included in maintenance integration |
| [#462](https://github.com/heznpc/AirMCP/pull/462) | Keep unsupported Podcasts disabled on macOS 26 and later | Included in maintenance integration |
| [#463](https://github.com/heznpc/AirMCP/pull/463) | Finder defaults, Spotlight time query, producer error propagation | Included in maintenance integration; addresses #459 and #460 |
| [#464](https://github.com/heznpc/AirMCP/pull/464) | Approval timeout and cancelled-request handling | Included in maintenance integration |
| [#467](https://github.com/heznpc/AirMCP/pull/467) | Test the actual producer and schema contracts | Included in maintenance integration |
| [#468](https://github.com/heznpc/AirMCP/pull/468) | Enforce coverage and widget test gates | Included in maintenance integration |
| [#473](https://github.com/heznpc/AirMCP/pull/473) | jose 6.2.10 and Zod 4.5.4 | Included; schema regression test now validates tuple behavior with Ajv 2020-12 |
| [#475](https://github.com/heznpc/AirMCP/pull/475) | Pinned GitHub Actions updates | Included in maintenance integration |
| [#478](https://github.com/heznpc/AirMCP/pull/478) | js-yaml 4.3.2 | Included in maintenance integration |
| [#480](https://github.com/heznpc/AirMCP/pull/480) | hono 4.13.7 | Included in maintenance integration |

Zod's `items: false` is a valid way to close a tuple in JSON Schema 2020-12.
The regression guard accepts valid pairs and null, and rejects missing, extra,
and incorrectly typed coordinates through the schema returned over MCP.
See the [JSON Schema array reference](https://json-schema.org/understanding-json-schema/reference/array).

## External reports and contributions

| Item | Verified history and remaining action |
| --- | --- |
| [#459](https://github.com/heznpc/AirMCP/issues/459) | Folder omission skipped tilde expansion. Fixed by #463; communicate the published fix version after release verification. |
| [#460](https://github.com/heznpc/AirMCP/issues/460) | Shell expansion consumed Spotlight's time token. Fixed by #463; communicate the published fix version after release verification. |
| [#406](https://github.com/heznpc/AirMCP/pull/406), [#412](https://github.com/heznpc/AirMCP/pull/412), [#415](https://github.com/heznpc/AirMCP/pull/415), [#417](https://github.com/heznpc/AirMCP/pull/417) | Already merged. Preserve the original PRs and authorship; no replacement commits or new closure needed. |
| [#418](https://github.com/heznpc/AirMCP/pull/418) | Draft closed by its author on 2026-07-30, followed by deletion of their head branch. No review or explanation was posted. Do not describe this as a maintainer rejection. |

## Remaining remote branches

The ten integration PR branches above are retained. Of the other seven remote
branches in the starting snapshot, `main` is the release base and these six
remain preserved:

| Branch | Disposition |
| --- | --- |
| `claude/chatgpt-local-control-mcp-867bbe` | Contains a separate PR-template simplification; deferred from the runtime maintenance batch. |
| `codex/fix-app-resource-bundle` | Historical packaging work overlaps #451; retain until any residual changes are individually accounted for. |
| `codex/fix-execution-host-permissions` | Historical permission-host work overlaps #451; retain until any residual changes are individually accounted for. |
| `fix/notarize-api-key-auth` | #440 already closed after #451 incorporated the authentication change; retain the historical branch. |
| `docs/debt-ledger` | Separate documentation work; preserved outside this maintenance batch. |
| `feat/chatgpt-plugin` | Separate development with changes beyond this batch and a checked-out worktree; preserved. |

Local branch inventory before the integration's final documentation commit:
48 branches including the new integration branch; 25 are reachable from the
integration HEAD, six have equivalent patches, and 17 still have patches not
matched by `git cherry`. The last category is **not** proof that all changes are
missing: squash merges and later revisions require content review. Fifteen
worktrees are registered, including three with missing paths. None is a
deletion candidate merely because Git marks it merged or prunable.

## Release and archive gates

- Merge the maintenance integration only after CI and runtime verification.
- Publish and verify the maintenance artifacts through the existing protected
  release workflow; record the actual version here and on #459/#460.
- Keep unresolved development branches and all worktree anchors intact.
- Prepare a public handoff that points to an actually available successor.
- Only then apply EOL messaging, npm deprecation, and repository archival.

Archive/deprecation is not part of the maintenance integration itself.
