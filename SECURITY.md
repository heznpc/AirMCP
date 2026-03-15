# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public issue
2. Use [GitHub Security Advisories](https://github.com/heznpc/AirMCP/security/advisories/new) to report privately
3. Or email: **heznpc** (via GitHub profile)

## Security Features

- **gitleaks** — Scans for accidentally committed secrets on every push
- **npm audit** — Checks for known vulnerabilities in dependencies
- **License compliance** — Blocks copyleft licenses (GPL/AGPL)
- **OIDC publishing** — No npm tokens stored as secrets
- **Zod validation** — Runtime input validation on all tool parameters
- **JXA injection prevention** — `esc()` sanitizes all user input before script interpolation
- **stdio transport** — No network exposure, local-only communication
- **Shared note guard** — Destructive operations blocked on shared notes by default
