## Summary

<!-- What does this PR do? Keep it to 1-3 sentences. -->

## Linked Issue

<!--
  Use `Closes #123` so merging closes the issue automatically. `Refs #123`
  only cross-links it and leaves it open for a maintainer to close by hand.
  Use `Refs` only when the PR is a partial step toward the issue.
-->

Closes #

## Type of Change

- [ ] New feature (new tool, module, or prompt)
- [ ] Bug fix
- [ ] Refactoring (no behavior change)
- [ ] Documentation
- [ ] CI/CD or build configuration

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] User input is escaped with `esc()` / `escJxaShell()` (if adding JXA scripts)
- [ ] Tool has `annotations` with `readOnlyHint` or `destructiveHint`
- [ ] README / docs updated (if tool count or features changed)

## QA Reports

### Read-Only Smoke Test

<!--
  npm run build && npm run qa
-->

<details>
<summary>Read-Only Test Results (click to expand)</summary>

<!-- Paste the output of `node scripts/qa-test.mjs` below -->

```
PASS: ?  |  SKIP: ?  |  FAIL: ?  |  ERROR: ?
```

</details>

### CRUD Roundtrip Test

<!--
  npm run qa:crud
  (or specific modules: node scripts/qa-crud-test.mjs --module notes,calendar)
-->

<details>
<summary>CRUD Test Results (click to expand)</summary>

<!-- Paste the output of `node scripts/qa-crud-test.mjs` below -->

```
PASS: ?  |  SKIP: ?  |  FAIL: ?  |  WARN: ?
```

</details>

### Modules Affected

<!-- Check modules you changed — reviewers will focus on these. -->

- [ ] `notes`
- [ ] `reminders`
- [ ] `calendar`
- [ ] `contacts`
- [ ] `mail`
- [ ] `music`
- [ ] `finder`
- [ ] `safari`
- [ ] `system`
- [ ] `photos`
- [ ] `shortcuts`
- [ ] `messages`
- [ ] `intelligence`
- [ ] `tv`
- [ ] `ui`
- [ ] `screen`
- [ ] `maps`
- [ ] `podcasts`
- [ ] `weather`
- [ ] `pages`
- [ ] `numbers`
- [ ] `keynote`
- [ ] `location`
- [ ] `bluetooth`
- [ ] `google`
- [ ] `speech`
- [ ] `health`
- [ ] `memory`
- [ ] `audit`
- [ ] `spatial_prep`
- [ ] `webhooks`
- [ ] `powerautomate`
- [ ] Shared / Infrastructure

### Manual Testing

<!--
For modules in the "Skipped" list (Messages, Mail-Send, System-Power, etc.),
describe manual testing and outcomes here.
-->
