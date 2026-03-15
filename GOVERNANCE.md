# Governance

## Overview

AirMCP is maintained by [@heznpc](https://github.com/heznpc). This document describes how the project is governed and how contributors can grow their involvement.

## Decision Making

- **Minor changes** (bug fixes, docs, tests): Merged by maintainer after CI passes.
- **New tools/modules**: Discussed in a GitHub Issue or Discussion before implementation. PR reviewed for security (JXA escaping), safety annotations, and test coverage.
- **Breaking changes**: Announced in GitHub Discussions at least 1 week before merging. Documented in CHANGELOG.md.
- **Architecture changes**: Discussed in a GitHub Issue with rationale before implementation.

## Roles

### Contributor
Anyone who submits a PR, files an issue, or participates in Discussions.

### Module Maintainer
Trusted contributors may be granted ownership of specific modules (e.g., `src/music/`, `src/photos/`). Module maintainers can:
- Approve PRs that only affect their module
- Triage issues for their module
- Be listed in CODEOWNERS for their module

**How to become one:** Contribute 3+ merged PRs to a module, then request ownership via a Discussion post.

### Core Maintainer
Full write access and release authority. Currently: @heznpc.

**How to become one:** Sustained contribution across multiple modules + demonstrated understanding of the project's security model and architecture.

## Release Process

- Releases follow [Semantic Versioning](https://semver.org/).
- Patch releases (x.y.Z): Bug fixes, shipped as needed.
- Minor releases (x.Y.0): New tools/features, shipped when ready.
- Major releases (X.0.0): Breaking changes, announced in advance.
- All releases are automated via GitHub Actions CD pipeline.

## Code of Conduct

All participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
