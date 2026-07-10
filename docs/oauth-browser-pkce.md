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
export AIRMCP_ALLOWED_ORIGINS=https://claude.ai,https://chrome-extension://<your_ext_id>
npx airmcp --http --port 3847 --bind-all
```

Startup refuses to boot unless `AIRMCP_OAUTH_ISSUER` (must be https://), `AIRMCP_OAUTH_AUDIENCE`, and the allow-list are all set (see `validateNetworkPolicy` in `src/server/http-transport.ts`). The `with-oauth+origin` variant additionally enforces the CORS allow-list at the middleware layer. The two RFC 8414 endpoint variables are optional, but they are a pair: setting only one also refuses startup.

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
| `mcp:read`        | Every `readOnlyHint: true` tool                  |
| `mcp:write`       | Non-destructive writes (`create_*`, `update_*`) |
| `mcp:destructive` | `destructiveHint: true` tools (`delete_*`, `trash_*`, `send_*`) |
| `mcp:admin`       | `audit_log`, `audit_summary`, `memory_forget`, `setup_permissions` |

Scope hierarchy is cumulative — `mcp:admin` implies all three others, `mcp:destructive` implies `write` + `read`, and so on. You don't need your AS to mint stacked scope sets unless your auth policy wants explicit enumeration.

**Rule of thumb**: mint the minimum scope for the client's actual use case. A note-taking integration probably wants `mcp:read mcp:write` and nothing destructive. A company-internal "AI assistant" likely wants `mcp:destructive` to perform cleanup but **not** `mcp:admin` — admin is reserved for audit introspection, which needs its own approval gate.

---

## 7. Local development — the fast loop

`npm run dev:oauth` spins up a pinned Keycloak 26 devcontainer with an `airmcp` realm, `dev/dev` user, and all four scopes pre-declared. After the container is up (~15s):

```bash
export AIRMCP_OAUTH_ISSUER=http://localhost:8081/realms/airmcp
export AIRMCP_OAUTH_AUDIENCE=http://localhost:3000/mcp
export AIRMCP_ALLOW_NETWORK=with-oauth
npm run dev -- --http --port 3000

# In another shell: fetch a token (password grant, dev-only shortcut)
curl -s -X POST http://localhost:8081/realms/airmcp/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=airmcp-dev&username=dev&password=dev&scope=mcp:read mcp:write"
# → { "access_token": "eyJhbGci...", ... }

# Call an MCP endpoint with it
curl -s http://localhost:3000/.well-known/mcp.json | jq .authorization
```

Password grant is **only** for local verification. Production browser clients must use Authorization Code + PKCE; Keycloak's `airmcp-dev` client is configured to support both so you can switch flows without reconfiguring the realm.

---

## 8. Troubleshooting

| Symptom                                                                   | Likely cause                                                                 | Fix                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 401 `WWW-Authenticate: error="invalid_token", error_description="wrong_audience"` | Token's `aud` claim doesn't match `AIRMCP_OAUTH_AUDIENCE`                    | Include the `resource` parameter on both authorize + token requests (RFC 8707). Some AS require explicit audience mapping.             |
| 401 `error_description="wrong_issuer"`                                    | Token's `iss` claim doesn't exactly equal `AIRMCP_OAUTH_ISSUER`              | Issuer string is case-sensitive and must match byte-for-byte including trailing slash policy.                                          |
| 401 `error_description="unsupported_alg"`                                 | Token signed with HS256 / none / other excluded alg                          | AirMCP only accepts RS256 + ES256 per RFC 0005 R4. Configure your AS to sign with an asymmetric key.                                   |
| 503 `Retry-After: 10`                                                     | AirMCP could not reach the AS's JWKS endpoint                                | Check AS health + network reachability from AirMCP. JWKS is lazily fetched, so the first call after an AS outage hits this.            |
| 403 `WWW-Authenticate: Bearer error="insufficient_scope"`                | Token is valid but lacks the scope required by one or more `tools/call` requests | Mint a token containing the advertised `scope`, or keep the client on read/write-only tools. AirMCP performs this gate before SDK dispatch. |
| 403 when reusing an existing MCP session                                  | The request's `(sub, client_id\|azp)` differs from the principal that created the session | Start a new MCP session. Token refresh is allowed only for the same subject and OAuth client.                                           |
| CORS preflight 403                                                        | Origin not in `AIRMCP_ALLOWED_ORIGINS`                                       | Add the exact origin (scheme + host + port, no trailing slash). Chrome extensions use `chrome-extension://<id>`.                       |
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
