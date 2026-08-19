## Summary

<!-- What does this PR do, and why? 1-3 sentences. -->

## Linked Issue

<!--
  `Closes #123` closes the issue on merge. `Refs #123` only cross-links it —
  use that when the PR is a partial step.
-->

Closes #

## Checks

- [ ] `npm run lint && npm run typecheck && npm run build && npm test` pass
- [ ] JXA input is escaped with `esc()` / `escJxaShell()` (only if you touched JXA)
- [ ] New tools declare `readOnlyHint` or `destructiveHint` (only if you added a tool)

<!--
  Optional — the QA suites need a Mac with the Apple app permissions granted,
  so skipping them is expected for outside contributors. CI and the maintainer
  cover the rest.

    npm run qa        # read-only smoke
    npm run qa:crud   # CRUD roundtrip

  If you did run them, paste the summary lines here. If you tested anything by
  hand (Messages, Mail send, system power — the suites skip those), say so.
-->
