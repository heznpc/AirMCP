# OAuth 2.1 Authorization Code + PKCE — Browser MCP Clients

> **Status**: RFC 0005 Step 3. Discovery (Step 1, [#138](https://github.com/heznpc/AirMCP/pull/138)) and the JWT verifier + scope gate (Step 2, [#139](https://github.com/heznpc/AirMCP/pull/139)) shipped in **v2.11.0**. This guide covers how a browser-resident MCP client (Claude in Chrome, Managed Agents, custom browser extensions) completes the PKCE handshake against AirMCP's OAuth endpoints.
>
> **Audience**: operators wiring a browser or extension-hosted MCP client to an AirMCP server exposed on the public interface. If you only run AirMCP locally and connect via stdio, **none of this is needed** — keep the default `loopback-only` policy and skip this doc.
>
> **Prereqs**:
> - AirMCP v2.11.0+ (`npx airmcp --version` prints `2.11.0` or higher)
> - An OAuth 2.1 authorization server (Keycloak, Auth0, Hydra, Supabase, or Okta — anything that supports `authorization_code` grant with PKCE and publishes a JWKS endpoint)
> - A browser MCP client that supports the 2025-06-18 MCP authorization flow (Claude in Chrome, custom MCP extension, etc.)

---

## 1. Why PKCE here

Browser clients cannot keep a client secret. They're served from a public origin, anyone can View Source, and even WebExtension-packaged clients are effectively shipping credentials in clear. The classic OAuth 2.0 public-client workaround — Implicit Flow — is deprecated by OAuth 2.1 and rejected by the MCP 2025-06-18 spec.

**Authorization Code + PKCE** (RFC 7636) replaces the client secret with a per-request proof. The client generates a random `code_verifier`, derives `code_challenge = base64url(sha256(code_verifier))`, includes the challenge on the authorization request, and presents the original verifier on the token exchange. The AS enforces that they match. A leaked authorization code is worthless without the matching verifier, which the attacker can't observe.

PKCE is mandatory for every browser client hitting an AirMCP `with-oauth*` endpoint.

---

## 2. The happy path

Here is the complete flow end-to-end. Every arrow is an HTTP call the client has to make or redirect through.

```
┌──────────┐  1. GET /.well-known/mcp.json              ┌──────────┐
│ Browser  │─────────────────────────────────────────►  │ AirMCP   │
│ MCP      │  ◄──────────────────────────────────────── │          │
│ client   │  { authorization: { type: "oauth2", ... }} └──────────┘
│          │
│          │  2. GET /.well-known/oauth-protected-resource (RFC 9728)
│          │─────────────────────────────────────────►  AirMCP
│          │  ◄────────────────────────────────────────
│          │  { resource, authorization_servers, scopes_supported }
│          │
│          │  3. GET {issuer}/.well-known/openid-configuration
│          │─────────────────────────────────────────►  Auth Server
│          │  ◄────────────────────────────────────────
│          │  { authorization_endpoint, token_endpoint, ... }
│          │
│          │  4. Generate code_verifier (32-96 random bytes, base64url)
│          │     Compute code_challenge = base64url(sha256(verifier))
│          │
│          │  5. Redirect to {authorization_endpoint}?
│          │       response_type=code
│          │      &client_id=<your_client_id>
│          │      &redirect_uri=<your_redirect_uri>
│          │      &scope=mcp:read mcp:write
│          │      &resource=<audience_from_step_2>        ← RFC 8707
│          │      &code_challenge=<challenge>
│          │      &code_challenge_method=S256
│          │      &state=<random>
│          │─────────────────────────────────────────►  Auth Server
│          │
│          │  6. User signs in, consents to scopes
│          │
│          │  7. Auth Server redirects back with ?code=<auth_code>&state=<state>
│          │  ◄────────────────────────────────────────
│          │
│          │  8. POST {token_endpoint}
│          │       grant_type=authorization_code
│          │      &code=<auth_code>
│          │      &redirect_uri=<your_redirect_uri>
│          │      &client_id=<your_client_id>
│          │      &code_verifier=<the_verifier_from_step_4>
│          │      &resource=<audience>                    ← RFC 8707
│          │─────────────────────────────────────────►  Auth Server
│          │  ◄────────────────────────────────────────
│          │  { access_token, token_type: "Bearer", expires_in }
│          │
│          │  9. POST /mcp
│          │    Authorization: Bearer <access_token>
│          │    Mcp-Session-Id: <new session>
│          │─────────────────────────────────────────►  AirMCP
│          │                                             ├─ verify JWT (jose)
│          │                                             │  iss / aud / exp / nbf
│          │                                             │  alg ∈ {RS256, ES256}
│          │                                             ├─ extract scopes
│          │                                             └─ scope gate on every
│          │  ◄────────────────────────────────────────    tool call
│          │  { result: ... }
└──────────┘
```

The critical discipline:
- **`resource` parameter is required on both step 5 and step 8** (RFC 8707 Resource Indicators). Its value is the `resource` field AirMCP returned at step 2. Without it, the AS may issue an audience-less token that AirMCP will reject as `wrong_audience`.
- **`code_verifier` at step 8 must byte-match the random bytes generated at step 4**. Store it in `sessionStorage` or an in-memory closure; never persist it after token exchange.
- **`state` at step 7 must byte-match `state` at step 5**. Drop the response otherwise (it's a CSRF probe).

---

## 3. Server setup

On the AirMCP side, flip the network policy to an OAuth mode and point at your AS.

```bash
export AIRMCP_ALLOW_NETWORK=with-oauth+origin
export AIRMCP_OAUTH_ISSUER=https://auth.example.com/realms/airmcp
export AIRMCP_OAUTH_AUDIENCE=https://airmcp.example.com/mcp
# Optional: publish RFC 8414 metadata when these external-AS endpoints are
# intentionally reverse-proxied/co-hosted through AirMCP's HTTP origin.
export AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT=https://auth.example.com/realms/airmcp/protocol/openid-connect/auth
export AIRMCP_OAUTH_TOKEN_ENDPOINT=https://auth.example.com/realms/airmcp/protocol/openid-connect/token
# This deployment serves public Authorization Code + PKCE clients, so the AS
# accepts no client secret at its token endpoint.
export AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS=none
# Replace the example ID with the extension's exact 32-character lowercase
# a-p ID. Do not prefix chrome-extension:// with https://.
export AIRMCP_ALLOWED_ORIGINS='https://claude.ai,chrome-extension://abcdefghijklmnopabcdefghijklmnop'
npx airmcp --http --port 3847 --bind-all
```

Startup refuses to boot unless `AIRMCP_OAUTH_ISSUER` (must be https://), `AIRMCP_OAUTH_AUDIENCE`, and the allow-list are all set (see `validateNetworkPolicy` in `src/server/http-transport.ts`). The `with-oauth+origin` variant enforces the CORS allow-list before authentication, so an allowed browser can complete an unauthenticated `OPTIONS` preflight while the subsequent `/mcp` request still requires its bearer token. The two RFC 8414 endpoint variables are optional, but they are a pair: setting only one also refuses startup. Opting into that metadata publication also requires `AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS`; AirMCP never guesses an external AS capability. The public PKCE example explicitly uses `none`. A confidential-client deployment must list the AS's actual supported method(s).

JWT verification does not guess a fixed key path. AirMCP fetches issuer metadata at the RFC 8414 path (falling back on 404 to the Keycloak-compatible OIDC discovery suffix), requires the metadata `issuer` to exactly match `AIRMCP_OAUTH_ISSUER`, validates the HTTPS `jwks_uri`, then lets `jose` cache and rotate that key set. `AIRMCP_OAUTH_JWKS_URI` is an optional explicit HTTPS override for operators whose AS cannot publish metadata. A JWT access token must contain both a non-empty `sub` and an `exp`; a correctly signed token without an expiry is rejected as malformed rather than treated as indefinitely valid.

For browser calls, AirMCP echoes `Access-Control-Allow-Origin` only for an allowed origin and returns `Vary: Origin`. Preflight permits `GET`, `POST`, `DELETE`, and `OPTIONS`, with request headers `Authorization`, `Content-Type`, `Mcp-Session-Id`, `MCP-Protocol-Version`, `Last-Event-ID`, and `X-AirMCP-Run-Id`. Those include the headers emitted by the real Streamable HTTP SDK after initialization and during SSE resumption. Browser JavaScript may read `Mcp-Session-Id`, `MCP-Protocol-Version`, `X-Request-ID`, `WWW-Authenticate`, `Retry-After`, and the `RateLimit-*` response headers. The discovery endpoints under `/.well-known/` use the same origin policy so a browser can bootstrap OAuth safely.

Loopback binding is not browser trust. Under the default `loopback-only` policy, a request carrying an `Origin` header is denied unless that exact origin is present in `AIRMCP_ALLOWED_ORIGINS`; an arbitrary page served from `http://localhost:<port>` is not implicitly trusted. Native MCP clients and `curl` normally omit `Origin` and remain compatible. Operators who intentionally want to reject those no-Origin clients can separately set `AIRMCP_DENY_NO_ORIGIN=1`.

Verify discovery came up:

```bash
curl -s http://localhost:3847/.well-known/mcp.json | jq .authorization
# → { "type": "oauth2", "resource": "https://airmcp.example.com/mcp", ... }

curl -s http://localhost:3847/.well-known/oauth-protected-resource | jq .
# → { "resource": "https://airmcp.example.com/mcp",
#     "authorization_servers": ["https://auth.example.com/realms/airmcp"],
#     "bearer_methods_supported": ["header"],
#     "resource_signing_alg_values_supported": ["RS256", "ES256"],
#     "scopes_supported": ["mcp:read", "mcp:write", "mcp:destructive", "mcp:admin"] }

# RFC 9728 also uses the audience-derived insertion path. For the audience
# above this is the canonical path; the root path remains a compatibility alias.
curl -s http://localhost:3847/.well-known/oauth-protected-resource/mcp | jq .

# Present only when both optional endpoint variables are configured. Because
# the issuer has /realms/airmcp, RFC 8414 inserts that path after .well-known.
curl -s http://localhost:3847/.well-known/oauth-authorization-server/realms/airmcp | jq .
# → includes "token_endpoint_auth_methods_supported": ["none"] for the
# public PKCE configuration above.
```

If either endpoint 404s or the `authorization_servers` array is empty, recheck the env vars — Step 1 (#138) rejects half-configured OAuth policies on purpose so crawlers never see an empty card.

---

## 4. Client setup — Claude in Chrome

Claude's browser extension reads `/.well-known/mcp.json` at server-add time and drives the PKCE dance itself. Your work is at the AS side:

1. **Create a public OAuth client** in your AS with these properties:
   - Grant types: `authorization_code`, `refresh_token` (optional but recommended)
   - PKCE: required, `S256` challenge method
   - Redirect URIs: the Claude extension's published redirect URI (look for `claude.ai/oauth/callback` or the extension's `chrome-extension://...` URI in Anthropic's integration docs)
   - Scopes: `mcp:read`, `mcp:write`, `mcp:destructive`, `mcp:admin` (the subset you want this client to ever have)
   - Audience / aud claim: the AirMCP `resource` URL from step 2 (`https://airmcp.example.com/mcp`)

2. **In the Claude in Chrome settings**, add AirMCP by URL. The extension will read `/.well-known/mcp.json` and your authorization_server → the Claude → AS popup → back to Claude flow just works.

3. **On first use**, Claude will open a popup to your AS's authorization_endpoint with the parameters from step 5 above. Users sign in, consent to the scopes, and Claude gets the token back via PKCE.

---

## 5. Client setup — custom browser / extension clients

If you're building a custom MCP client, use a vetted OAuth client library instead of handrolling. The math is easy; it's the UX edge cases (state param CSRF, refresh-token race, token storage) that get you.

**Libraries we've verified against AirMCP's endpoints**:
- JavaScript: [`@openid/appauth`](https://github.com/openid/AppAuth-JS) (OpenID Foundation reference impl, handles PKCE + RFC 8707 cleanly)
- Go: `golang.org/x/oauth2` with a PKCE code verifier (standard library approach; RFC 8707 needs a one-line custom `AuthCodeOption`)
- Python: [`authlib`](https://authlib.org/) has first-class OAuth 2.1 support including `resource` parameter

Minimum client-side checklist (reviewer-friendly):
- [ ] `code_verifier` generated from `crypto.getRandomValues` or equivalent — **never** `Math.random`
- [ ] `code_challenge` computed with SHA-256, base64url-encoded, no padding
- [ ] `code_challenge_method=S256` (never `plain`)
- [ ] `state` param included on every auth request and validated on callback
- [ ] `resource` param (RFC 8707) present on BOTH authorization and token requests, matching AirMCP's `/.well-known/oauth-protected-resource` `resource` field
- [ ] Scopes space-separated in `scope` param, narrow to least-privilege (don't request `mcp:destructive` + `mcp:admin` for a read-only client)
- [ ] `code_verifier` stored in memory / sessionStorage only, discarded after token exchange
- [ ] Access token stored in memory or extension storage, **never** localStorage (XSS)
- [ ] 401 response carries `WWW-Authenticate: Bearer error="invalid_token"` — treat as "token bad or expired" and initiate refresh or re-auth
- [ ] 503 response with `Retry-After` header means AirMCP's AS is unreachable — retry rather than drop the session

---

## 6. Scope design — least-privilege per client

AirMCP maps scopes to tool classes via the `evaluateScopeGate` in `src/shared/oauth-scope.ts`:

| Scope             | Unlocks                                          |
| ----------------- | ------------------------------------------------ |
| `mcp:read`        | Every `readOnlyHint: true` tool and every MCP `resources/*` operation |
| `mcp:write`       | Non-destructive writes (`create_*`, `update_*`) |
| `mcp:destructive` | `destructiveHint: true` tools (`delete_*`, `trash_*`, `send_*`) |
| `mcp:admin`       | `audit_log`, `audit_summary`, `memory_forget`, `setup_permissions` |

Scope hierarchy is cumulative — `mcp:admin` implies all three others, `mcp:destructive` implies `write` + `read`, and so on. You don't need your AS to mint stacked scope sets unless your auth policy wants explicit enumeration.

The `resources/*` rule covers discovery operations as well as reads: OAuth callers need `mcp:read` for `resources/list`, `resources/templates/list`, `resources/read`, subscriptions, and related resource methods. A registered live-resource read then crosses the same core runtime boundary as a tool call: per-tenant rate limiting, a namespaced `resource:<name>` HMAC audit outcome, and (for sensitive resources) per-call HITL. AirMCP's built-in live Apple-data resources—including clipboard and composite context snapshots—are sensitive by default. An approved read does not enter its callback until that exact random-`approvalId` decision is durable and verified in the audit chain; a denial stays a categorized JSON-RPC error and never returns resource content.

**Rule of thumb**: mint the minimum scope for the client's actual use case. A note-taking integration probably wants `mcp:read mcp:write` and nothing destructive. A company-internal "AI assistant" likely wants `mcp:destructive` to perform cleanup but **not** `mcp:admin` — admin is reserved for audit introspection, which needs its own approval gate.

---

## 7. Local development — Node/curl verification loop

`npm run dev:oauth` is a Node/curl verifier integration harness. It spins up a pinned Keycloak 26 devcontainer with an `airmcp` realm, `dev/dev` user, and all four scopes pre-declared. The launcher creates a seven-day, process-local CA certificate, starts Keycloak on HTTPS, and owns a loopback-only reverse proxy from `https://127.0.0.1:3443` to AirMCP's internal `http://127.0.0.1:3000` listener. It does not relax AirMCP's rule that every OAuth issuer and resource audience use `https://`. Copy the certificate path printed by the launcher. The proxy, container, and certificate are removed together when you stop it.

After the container is up (~15s), run the exact commands printed in its banner:

```bash
export NODE_EXTRA_CA_CERTS='/path/printed/by/dev-oauth/localhost.pem'
export AIRMCP_OAUTH_ISSUER=https://localhost:8443/realms/airmcp
export AIRMCP_OAUTH_AUDIENCE=https://127.0.0.1:3443/mcp
export AIRMCP_ALLOW_NETWORK=with-oauth
npm run dev -- --http --port 3000

# In another shell: fetch a token (password grant, dev-only shortcut)
curl -s --cacert "$NODE_EXTRA_CA_CERTS" \
  -X POST https://localhost:8443/realms/airmcp/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=airmcp-dev&username=dev&password=dev&scope=mcp:read mcp:write"
# → { "access_token": "eyJhbGci...", ... }

# Use the public resource URL, not AirMCP's internal HTTP upstream
curl -s --cacert "$NODE_EXTRA_CA_CERTS" \
  https://127.0.0.1:3443/.well-known/oauth-protected-resource | jq .
curl -s --cacert "$NODE_EXTRA_CA_CERTS" \
  https://127.0.0.1:3443/.well-known/mcp.json | jq .authorization
```

`NODE_EXTRA_CA_CERTS` must be present when the AirMCP Node process starts; setting it afterward does not update Node's trust store. The local realm maps `https://127.0.0.1:3443/mcp` into the access token's `aud` claim so the verifier exercises the same issuer/audience checks as production. The proxy binds only to IPv4 loopback and forwards only to the fixed IPv4-loopback AirMCP upstream; it is not a general-purpose proxy.

Password grant is **only** for this local Node/curl verification. Production browser clients must use Authorization Code + PKCE, but this launcher is not a browser PKCE harness: its ephemeral CA is trusted only by the explicitly configured Node process and `curl --cacert`, not installed into the macOS or browser trust store, and it does not host a browser callback application. Use a separately trusted HTTPS development origin and a non-conflicting callback port when testing the browser flow. HTTP remains an internal implementation detail for the fixed proxy upstream—not an OAuth issuer, metadata, JWKS, or resource identity.

---

## 8. Troubleshooting

| Symptom                                                                   | Likely cause                                                                 | Fix                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 401 `WWW-Authenticate: error="invalid_token", error_description="wrong_audience"` | Token's `aud` claim doesn't match `AIRMCP_OAUTH_AUDIENCE`                    | Include the `resource` parameter on both authorize + token requests (RFC 8707). Some AS require explicit audience mapping.             |
| 401 `error_description="wrong_issuer"`                                    | Token's `iss` claim doesn't exactly equal `AIRMCP_OAUTH_ISSUER`              | Issuer string is case-sensitive and must match byte-for-byte including trailing slash policy.                                          |
| 401 `error_description="unsupported_alg"`                                 | Token signed with HS256 / none / other excluded alg                          | AirMCP only accepts RS256 + ES256 per RFC 0005 R4. Configure your AS to sign with an asymmetric key.                                   |
| 503 `Retry-After: 10`                                                             | AirMCP could not load valid issuer metadata or the advertised JWKS                        | Check AS health, the metadata `issuer` exact match, and its HTTPS `jwks_uri`. Metadata and JWKS are fetched lazily and cached.              |
| 403 `WWW-Authenticate: Bearer error="insufficient_scope"`                | Token is valid but lacks the scope required by one or more `tools/call` requests | Mint a token containing the advertised `scope`, or keep the client on read/write-only tools. AirMCP performs this gate before SDK dispatch. |
| 403 when reusing an existing MCP session                                  | The request's `(sub, client_id\|azp)` differs from the principal that created the session | Start a new MCP session. Token refresh is allowed only for the same subject and OAuth client.                                           |
| CORS preflight 403                                                                | Origin/method/header is outside the browser contract                                      | Add the exact HTTP(S) origin, or canonical `chrome-extension://<32 lowercase a-p ID>`. Only documented CORS methods/headers are accepted.   |
| Startup refuses to boot on `with-oauth*`                                  | Issuer/audience is missing or invalid, or only one RFC 8414 endpoint variable is set | Set issuer + audience; if publishing authorization-server metadata, set both authorization + token endpoints. Issuer must be https://. |
| Token exchange at step 8 returns `invalid_grant`                          | `code_verifier` doesn't match the original `code_challenge` for this `code`  | Make sure the same verifier → challenge pair is used end-to-end. The code is one-use; a retry without a fresh authorize will fail.     |

---

## 9. References

- RFC 0005 (this repo): [`docs/rfc/0005-oauth-resource-indicators.md`](rfc/0005-oauth-resource-indicators.md)
- [MCP 2025-06-18 Authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [RFC 7636 — Proof Key for Code Exchange (PKCE)](https://www.rfc-editor.org/rfc/rfc7636)
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707)
- [RFC 9728 — OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728)
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)
- AppAuth-JS (recommended library): <https://github.com/openid/AppAuth-JS>
- AirMCP OAuth verifier implementation: [`src/server/oauth-verifier.ts`](../src/server/oauth-verifier.ts)
- AirMCP scope gate: [`src/shared/oauth-scope.ts`](../src/shared/oauth-scope.ts)
