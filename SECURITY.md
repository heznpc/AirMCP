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

## Dependency Advisory SLAs

AirMCP treats advisories reported by `npm audit` according to the table below. The policy is defined in **RFC 0003 — npm audit upgrade plan** (`docs/rfc/0003-npm-audit-policy.md`); the rollout is staged so CI behaviour changes only after a holding period at each severity level.

| Severity | CI behaviour today | Triage SLA | Fix SLA |
| -------- | ------------------ | ---------- | ------- |
| critical | hard block (CI fails) | 1 business day | 3 business days |
| high | hard block (CI fails) | 3 business days | 7 business days |
| moderate | advisory only (summarised in CI logs) | 5 business days | next minor release |
| low / info | no CI action | best effort | best effort |

The moderate+ advisory is emitted by `scripts/summarize-audit.mjs`, which runs as a non-fatal step in `.github/workflows/ci.yml` immediately after the hard `npm audit --audit-level=high` gate. Once we've held moderate findings at zero for one release, RFC 0003 Phase 2 swaps the hard gate down to `moderate` and retires the advisory step.

### Runtime
- **Zod validation** — All 268 string input parameters have `.max()` length limits to prevent oversized-input DoS
- **JXA injection prevention** — `esc()`, `escAS()`, `escShell()`, `escJxaShell()` sanitize all user input before script interpolation
- **Swift bridge prototype pollution guard** — JSON responses from the Swift helper are parsed with a reviver that rejects `__proto__` / `constructor` / `prototype` keys at any depth (see `src/shared/swift.ts`)
- **PII scrubbing** — Email addresses and file paths redacted from error messages
- **Audit logging** — Sensitive keys auto-redacted, log files restricted to owner-read-write (0o600)
- **stdio transport** — No network exposure, local-only communication
- **HTTP security** — Bearer token auth (timing-safe, SHA-256 hashed), rate limiting (120 req/min), origin validation, session timeout
- **Shared note guard** — Destructive operations blocked on shared notes by default
- **HITL gating** — Configurable human-in-the-loop approval for destructive operations

## Outbound Network Calls (JXA / AppleScript / Swift)

AirMCP's inbound attack surface (HTTP transport, stdio JSON-RPC) is defended by the items above. For traffic going the *other* direction — AppleScript `do shell script` with `curl`, JXA using `ObjC.import('Foundation')` for URL requests, or a Swift bridge command hitting the network — the following boundary applies:

- **No centralised outbound policy.** Each module is responsible for the network calls it makes. AirMCP does not interpose a proxy, TLS pin, or per-host rate limit on outbound traffic.
- **Current usage is minimal.** The only built-in outbound paths are the `google` module (OAuth 2.0 + Calendar/Drive/Gmail APIs over TLS to Google-owned hosts) and the `weather` module (Apple's WeatherKit / first-party system APIs). Neither forwards user-controlled URLs.
- **If you add a new outbound call**: validate the destination against an allowlist or require an explicit opt-in config flag. Do *not* fetch URLs pulled from note bodies, calendar descriptions, reminder notes, or any other user-editable field without sanitisation.
- **Third-party modules / user skills** that make network calls are outside this threat model; users should review `~/.airmcp/skills/*` before enabling them.

Report any outbound-path concerns via the reporting channel at the top of this document.
