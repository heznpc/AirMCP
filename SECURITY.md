# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public issue
2. Use [GitHub Security Advisories](https://github.com/heznpc/AirMCP/security/advisories/new) to report privately
3. Or email: **heznpc** (via GitHub profile)

## Security Features

### Build & Supply Chain
- **Source map disabled** — `sourcemap: false` explicitly set in esbuild to prevent accidental source exposure via npm
- **Package verification** — `npm pack --dry-run` pre-publish gate rejects `.map`, `.ts`, `.env`, and `.token` files
- **npm audit** — Checks for known vulnerabilities in dependencies
- **npm signature verification** — `npm audit signatures` validates package provenance on every CI run
- **gitleaks** — Scans for accidentally committed secrets on every push
- **License compliance** — Blocks copyleft licenses (GPL/AGPL)
- **OIDC publishing** — No npm tokens stored as secrets

### Runtime
- **Zod validation** — All 268 string input parameters have `.max()` length limits to prevent oversized-input DoS
- **JXA injection prevention** — `esc()`, `escAS()`, `escShell()`, `escJxaShell()` sanitize all user input before script interpolation
- **PII scrubbing** — Email addresses and file paths redacted from error messages
- **Audit logging** — Sensitive keys auto-redacted, log files restricted to owner-read-write (0o600)
- **stdio transport** — No network exposure, local-only communication
- **HTTP security** — Bearer token auth (timing-safe), rate limiting (120 req/min), origin validation, session timeout
- **Shared note guard** — Destructive operations blocked on shared notes by default
- **HITL gating** — Configurable human-in-the-loop approval for destructive operations
