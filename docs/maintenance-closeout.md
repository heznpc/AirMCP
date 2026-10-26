# AirMCP maintenance closeout

Current verification: **2026-10-27 KST**, release **v2.16.7**, source
`15e59b4774209761267597d33d4545d608692023` ([PR #512](https://github.com/heznpc/AirMCP/pull/512)).
The npm and MCPB distributions are published and verified. **The signed macOS
app distribution is incomplete.** Repository archival and a claim that the
release is fully complete must wait for that gate.

## Current distribution evidence

| Deliverable | Verified state |
| --- | --- |
| `airmcp@2.16.7` | Registry version, `latest`, SHA-512 tarball identity and source commit match the release tag. A fresh registry install boots the full runtime with 292 tools; `npx -y airmcp@2.16.7 --version` succeeds. |
| 12 `@heznpc/airmcp-*` add-ons | All registry versions, `latest` tags, tarball identities and source commits match. Fresh installation and import of all 12 packages succeeds. |
| `airmcp-2.16.7.mcpb` | Downloaded from the public release and verified to boot self-contained with 291 tools and 28 modules. |
| `AirMCP-2.16.7.zip` | **Missing.** [Signed-app run 40283570244](https://github.com/heznpc/AirMCP/actions/runs/40283570244) failed at **Verify notarization account access**. No successful notarization or public app ZIP is claimed. |

Registry verification ran from the immutable v2.16.7 source after building the
runtime and add-on packages, with `release:verify --skip-github`. That flag
excludes the known missing app asset; its success is **not** full-release
verification. Running source-identity verification from a later `main` commit
compares different package contents and is not a valid release check.

The public MCPB was checked with `verify-mcpb-artifact.mjs --path=<downloaded-file>`.
Its SHA-256 matches the GitHub asset digest:
`059470aeadf866d06012ebff1b35b9aebd5c338bcc131b728c0f04d7adfb437d`.
The MCPB probe explicitly disables proactive context, while the npm probe
retains the default `proactive_context` tool; this accounts for the one-tool
difference between the recorded smoke checks.

## Fixes and prior validation

[PR #512](https://github.com/heznpc/AirMCP/pull/512) fixes cancelled delegated
calls, delegated output-schema validation, app approval socket/timer handling,
Safari and Mail output contracts, Shortcuts input handling and unsupported
operations, Finder error propagation, Reminders flag semantics, and delayed
audit flushing during app acceptance. Its regression tests first failed on the
original implementations and then passed with the fixes.

The recorded validation includes 3,064 JavaScript tests across 239 suites,
113 Swift app tests, 33 Swift bridge tests, successful CI, and governed app
preflight covering authenticated reads, approved and denied writes, emergency
stop, and audit verification. These are the implementation checks recorded in
that PR, distinct from the fresh public-package checks above. Local app
acceptance does not establish Apple notarization or public distribution.

[PR #516](https://github.com/heznpc/AirMCP/pull/516) repairs automatic-release
npm authentication selection. It does not repair the Apple account credentials.

## Remaining release gate and recovery

1. Correct the Apple notarization credentials in GitHub's protected `release`
   environment. The current blocker is authentication, not a missing source fix.
2. Resume the signed app for the existing immutable release; do not republish
   the npm packages or move the tag:

   ```bash
   GITHUB_REPOSITORY=heznpc/AirMCP \
   RELEASE_TAG=v2.16.7 \
   RELEASE_SHA=15e59b4774209761267597d33d4545d608692023 \
   node scripts/dispatch-signed-app-release.mjs
   ```

3. Require a successful signed-app workflow, public `AirMCP-2.16.7.zip`, and
   the full `release:verify` check from the release source without skip flags.
   Download the public ZIP and verify its signature, stapled ticket, launch,
   and app-owned runtime before recording app distribution as complete.
4. Keep [issue #511](https://github.com/heznpc/AirMCP/issues/511) open until its
   missing-app report is resolved. Update the README, installation guide and
   release notes when the app asset becomes available.

The v2.16.6 end-of-maintenance proposal in
[PR #510](https://github.com/heznpc/AirMCP/pull/510) is superseded by this release
record. Do not apply its old final-version notices or archive the repository
while the app gate remains unresolved. No public successor is required or
designated by this record.

## Historical integration record

The sections below preserve the September integration and October 21 release
preparation snapshots. Their versions, issue states, dependency findings and
inventories are historical; the current release state is recorded above.

## Preserved source

The remote tag [`final-source/airmcp-v2.16.5`](https://github.com/heznpc/AirMCP/tree/final-source/airmcp-v2.16.5)
preserves `6e85de94ee71011c2ac318adeabfa5d43bde50b2`. It is a source-provenance
anchor, not a new release tag. Subsequent maintenance must not move it.

## Maintenance integration

The integration is [PR #482](https://github.com/heznpc/AirMCP/pull/482), branch
`chore/airmcp-maintenance-closeout`, based on main
`cceaab9cbe1614151af405f5e2f6372dac616fc1`. Original PR commits are retained with
merge commits so contribution history and source ancestry survive integration.

| PR                                                | Change                                                            | Disposition                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [#461](https://github.com/heznpc/AirMCP/pull/461) | Redact UI input in audit rows and previews                        | Included in maintenance integration                                            |
| [#462](https://github.com/heznpc/AirMCP/pull/462) | Keep unsupported Podcasts disabled on macOS 26 and later          | Included in maintenance integration                                            |
| [#463](https://github.com/heznpc/AirMCP/pull/463) | Finder defaults, Spotlight time query, producer error propagation | Included in maintenance integration; addresses #459 and #460                   |
| [#464](https://github.com/heznpc/AirMCP/pull/464) | Approval timeout and cancelled-request handling                   | Included in maintenance integration                                            |
| [#467](https://github.com/heznpc/AirMCP/pull/467) | Test the actual producer and schema contracts                     | Included in maintenance integration                                            |
| [#468](https://github.com/heznpc/AirMCP/pull/468) | Enforce coverage and widget test gates                            | Included in maintenance integration                                            |
| [#473](https://github.com/heznpc/AirMCP/pull/473) | jose 6.2.10 and Zod 4.5.4                                         | Included; schema regression test now validates tuple behavior with Ajv 2020-12 |
| [#475](https://github.com/heznpc/AirMCP/pull/475) | Pinned GitHub Actions updates                                     | Included in maintenance integration                                            |
| [#478](https://github.com/heznpc/AirMCP/pull/478) | js-yaml 4.3.2                                                     | Included in maintenance integration                                            |
| [#480](https://github.com/heznpc/AirMCP/pull/480) | hono 4.13.7                                                       | Included in maintenance integration                                            |

Zod's `items: false` is a valid way to close a tuple in JSON Schema 2020-12.
The regression guard accepts valid pairs and null, and rejects missing, extra,
and incorrectly typed coordinates through the schema returned over MCP.
See the [JSON Schema array reference](https://json-schema.org/understanding-json-schema/reference/array).

The docs site's remaining audit finding, [GHSA-7w5x-hrqm-74c2](https://github.com/advisories/GHSA-7w5x-hrqm-74c2),
is addressed by updating its locked `smol-toml` from 1.7.0 to 1.8.0.

## Validation evidence

- Node 22: 233 suites / 2,965 tests pass with coverage thresholds enabled;
  lint, typecheck, formatting, and build pass.
- Generated catalog, manifest, intents, version/stats/i18n, package boundaries,
  profile exposure, and harness adapter wire checks pass.
- Swift app: 99 tests; widget: 10 tests; AirMCPKit: 31 tests; iOS server package:
  23 tests pass on macOS.
- Root and docs-site npm audits report zero vulnerabilities. The docs site
  builds all 34 pages with the updated TOML dependency.
- Actual MCP calls return indexed files for both omitted and explicit home
  folders. A missing directory returns an error instead of an empty success.
- The packed npm artifact boots from a clean installation in starter and full
  modes. The local app bundle passes authenticated HTTP/MCP, read, approved and
  denied writes, emergency stop, and verification of nine audit entries.
- The runtime bundle used ad-hoc signing. Signed release distribution and
  AppIntents registration are separate release checks, not established here.

## External reports and contributions

| Item                                                                                                                                                                                                       | Verified history and remaining action                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#459](https://github.com/heznpc/AirMCP/issues/459)                                                                                                                                                        | Folder omission skipped tilde expansion. Fixed by #463; communicate the published fix version after release verification.                                                 |
| [#460](https://github.com/heznpc/AirMCP/issues/460)                                                                                                                                                        | Shell expansion consumed Spotlight's time token. Fixed by #463; communicate the published fix version after release verification.                                         |
| [#406](https://github.com/heznpc/AirMCP/pull/406), [#412](https://github.com/heznpc/AirMCP/pull/412), [#415](https://github.com/heznpc/AirMCP/pull/415), [#417](https://github.com/heznpc/AirMCP/pull/417) | Already merged. Preserve the original PRs and authorship; no replacement commits or new closure needed.                                                                   |
| [#418](https://github.com/heznpc/AirMCP/pull/418)                                                                                                                                                          | Draft closed by its author on 2026-07-30, followed by deletion of their head branch. No review or explanation was posted. Do not describe this as a maintainer rejection. |

## Remaining remote branches

The ten integration PR branches above are retained. Of the other seven remote
branches in the starting snapshot, `main` is the release base and these six
remain preserved:

| Branch                                    | Disposition                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `claude/chatgpt-local-control-mcp-867bbe` | Contains a separate PR-template simplification; deferred from the runtime maintenance batch.                     |
| `codex/fix-app-resource-bundle`           | Historical packaging work overlaps #451; retain until any residual changes are individually accounted for.       |
| `codex/fix-execution-host-permissions`    | Historical permission-host work overlaps #451; retain until any residual changes are individually accounted for. |
| `fix/notarize-api-key-auth`               | #440 already closed after #451 incorporated the authentication change; retain the historical branch.             |
| `docs/debt-ledger`                        | Separate documentation work; preserved outside this maintenance batch.                                           |
| `feat/chatgpt-plugin`                     | Separate development with changes beyond this batch and a checked-out worktree; preserved.                       |

Local branch inventory before the integration's final documentation commit:
48 branches including the new integration branch; 25 are reachable from the
integration HEAD, six have equivalent patches, and 17 still have patches not
matched by `git cherry`. The last category is **not** proof that all changes are
missing: squash merges and later revisions require content review. Fifteen
worktrees are registered, including three with missing paths. None is a
deletion candidate merely because Git marks it merged or prunable.

## Historical release and archive plan

- Merge the maintenance integration only after CI and runtime verification.
- Publish and verify the maintenance artifacts through the existing protected
  release workflow; record the actual version here and on #459/#460.
- Keep unresolved development branches and all worktree anchors intact.
- Prepare a public handoff that points to an actually available successor.
- Only then apply EOL messaging, npm deprecation, and repository archival.

Archive/deprecation is not part of the maintenance integration itself.

## Historical maintenance release preparation (2026-10-21)

- #506 is merged at `e0694e0d662a7e2d578c6fcd7bca506591bfd0f2`: private
  runtime credential files, read-only retries, isolated Swift process lanes,
  MCP SDK 1.32.1, and security dependency lockfile updates.
- Dependabot #502 and #503 are closed as superseded by #506. #500's security
  changes (SDK, qs 6.16.0, proxy-addr 2.0.8) are already present; its remaining
  upgrades are deferred. #504/#505 routine tooling updates and #485's major
  ext-apps migration are closed as outside the final maintenance scope.
- #459 and #460 were reopened after stale automation closed them prematurely.
  They remain open until the published 2.16.6 artifact is verified.
- Runtime and docs-site dependency audits report zero vulnerabilities. The
  development-only Jest chain reports 19 moderate dependency findings rooted
  in the single unpatched `sprintf-js` advisory
  [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
  This dependency is not shipped in the production installation; no forced
  Jest downgrade or unverified override is applied.
- The owner authorized the final maintenance release, published-version
  follow-up on both reports, final inventory, and repository archival.
  Publication and archive completion must be recorded only after verification.

- Release preflight exposed a verification-harness mismatch after #506: app-owned
  children correctly reject inherited runtime overrides. The app acceptance and
  signed-artifact probes now use normal config locations under their disposable
  home, preserving the hardened environment boundary.
