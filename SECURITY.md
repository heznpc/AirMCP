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
- **Audit logging** — Sensitive keys auto-redacted, log files restricted to owner-read-write (0o600). The active file rotates to `audit.<timestamp>.jsonl` when it exceeds 10 MiB (`AUDIT.MAX_FILE_SIZE` in `src/shared/constants.ts`); rotated files are kept indefinitely so the genesis-anchored HMAC chain can be verified end-to-end across history (covered by `tests/audit-tamper-detection.test.js`). All files stay on the user's machine — no off-machine retention; deletion is a user-initiated `rm` of `~/.airmcp/audit*.jsonl`.
- **stdio transport** — No network exposure, local-only communication
- **HTTP security** — Bearer token auth (timing-safe, SHA-256 hashed), rate limiting (120 req/min), origin validation, session timeout
- **Shared note guard** — Destructive operations blocked on shared notes by default
- **HITL gating** — Configurable human-in-the-loop approval for destructive operations

## Enforcement Scope and Honest Limits

The features above are real, but each enforces at a specific boundary. A reader who assumes "governed" means "globally enforced" would over-trust the runtime, so this table is the authoritative scope statement and every row is grounded in the cited source. The fuller mechanism-by-mechanism accounting — including the parts that are advisory only — lives in `docs/experiments/defended-vs-undefended-ablation-design.md`.

| Mechanism | Enforced scope | Honest limit |
| --------- | -------------- | ------------ |
| Emergency stop | Destructive-classified calls | **Not** a global halt. The gate is `if (destructive && isEmergencyStopActive())` in `src/shared/rate-limit.ts`; non-destructive reads continue while the stop file exists. |
| Per-call HITL approval | Gated calls at the configured level, when an approval channel exists | Fails **closed** — with no elicitation or approval socket, gated calls are denied (`src/shared/hitl-guard.ts`). But an operator can set `hitl.level: off`, which removes the gate entirely. |
| Tamper-evident audit chain | Every call | Tamper-**evident**, not tamper-proof. `governed` stays `true` under a host-derived key, so the honest one-line verdict is `assurance`, never bare `governed` (`src/shared/resources.ts`). |
| Audit key strength | Chain HMAC | `assurance: operator-attested` means the key is not derivable from host facts — it does **not** by itself mean non-repudiation. The `keyfile` variant is readable by any same-user process; only `keySource: "env"` resists a same-user local attacker (`src/shared/identity-key.ts`). |
| Privacy-sensitive READ classification | Build time only | `src/shared/privacy-sensitive-tools.ts` is imported by no runtime path — only by `tests/safety-annotations.test.js`. It keeps the per-tool `sensitiveHint` annotations from drifting, and that annotation is what gates at runtime. It is **not** wired into the OAuth scope gate. |
| OAuth scope gate | HTTP requests carrying OAuth claims | Applies only when the OAuth policy is active **and** claims are present; `rejectInsufficientScopes` returns early otherwise (`src/server/http-transport.ts`). stdio, loopback, and legacy bearer sessions are not scope-gated. |

Two consequences worth stating plainly:

- **A successful tool call is evidence that a step ran, not proof that the user's task completed.** The audit chain records calls; it does not verify end state in the target app.
- **Run identity belongs to the caller.** AirMCP governs individual calls and correlates them via the optional `X-AirMCP-Run-Id` header (UUID-validated in `src/server/http-transport.ts`). Absent that header there is no server-side run object grouping a multi-call task.

## Outbound Network Calls (JXA / AppleScript / Swift)

AirMCP's inbound attack surface (HTTP transport, stdio JSON-RPC) is defended by the items above. For traffic going the *other* direction — AppleScript `do shell script` with `curl`, JXA using `ObjC.import('Foundation')` for URL requests, or a Swift bridge command hitting the network — the following boundary applies:

- **No centralised outbound policy.** Each module is responsible for the network calls it makes. AirMCP does not interpose a proxy, TLS pin, or per-host rate limit on outbound traffic.
- **Current usage is minimal.** The only built-in outbound paths are the `google` module (OAuth 2.0 + Calendar/Drive/Gmail APIs over TLS to Google-owned hosts) and the `weather` module (Apple's WeatherKit / first-party system APIs). Neither forwards user-controlled URLs.
- **If you add a new outbound call**: validate the destination against an allowlist or require an explicit opt-in config flag. Do *not* fetch URLs pulled from note bodies, calendar descriptions, reminder notes, or any other user-editable field without sanitisation.
- **Third-party modules / user skills** that make network calls are outside this threat model; users should review `~/.airmcp/skills/*` before enabling them.

Report any outbound-path concerns via the reporting channel at the top of this document.
