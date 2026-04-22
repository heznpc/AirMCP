# RFC 0005 — OAuth 2.1 + Resource Indicators (MCP 2025-06-18 spec)

- **Status**: Draft
- **Author**: heznpc + Claude
- **Created**: 2026-04-23
- **Target**: v2.11.0
- **Related**: RFC 0002 (HTTP allowNetwork policy), `src/server/http-transport.ts` (Bearer token path), [MCP 2025-06-18 authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization), [RFC 8707 Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707)

---

## 1. Motivation

AirMCP의 HTTP 모드는 현재 **Bearer 토큰 단일 계층** 인증을 제공한다. `AIRMCP_HTTP_TOKEN`을 환경 변수로 설정하면 서버가 `Authorization: Bearer <token>`을 SHA-256 + `timingSafeEqual`로 검증한다 ([src/server/http-transport.ts:255-277](../../src/server/http-transport.ts:255)). 이는 v2.7.0부터 안정적으로 운영 중이고, RFC 0002에서 정책화(`with-token`, `with-token+origin`)까지 강화되어 있다.

그러나 **2025-06-18 MCP 사양 개정**은 인증 축을 OAuth 2.1 + Resource Indicators (RFC 8707)로 옮겼다:

1. **확장 가능성**: 단일 정적 토큰은 다중 사용자·다중 서버 환경에서 확장되지 않는다. 엔터프라이즈 배포에서는 사용자별 권한 분리·토큰 회수·수명 관리가 필수.
2. **Confused Deputy 공격 방지**: 토큰이 여러 서버에 걸쳐 재사용될 경우, 한 서버가 다른 서버에 대한 요청을 대신 수행할 위험이 있다. Resource Indicators는 "이 토큰은 어느 MCP 서버용인지"를 명시해 이 공격을 차단한다.
3. **Managed Agents·Cowork**: Claude의 Managed Agents 생태계가 Dynamic Client Registration(DCR)을 전제로 동작한다. AirMCP가 이 흐름에 합류하려면 OAuth 2.1 AS(Authorization Server) 또는 외부 AS 위임 모델이 필요.
4. **브라우저 MCP 클라이언트** (Claude in Chrome 등): 쿠키 기반 인증이 아닌 토큰 기반 흐름이 요구되며, PKCE가 사실상 필수.

### 현 상태의 실질적 한계
- Bearer 토큰은 **기기 단위** 비밀로, 실수로 로그/Git·공유 터미널에 노출되면 회수 불가(수동 재발급 필요).
- 토큰 **만료(TTL)** 가 없다. 한 번 발급되면 영구.
- `.well-known/mcp.json`은 `authorization: { type: "bearer" }`만 선언 ([mcp-setup.ts 관련 로직](../../src/server/mcp-setup.ts)). OAuth flow 메타데이터 부재.

---

## 2. Goals

1. MCP 2025-06-18 사양의 **OAuth 2.1 클라이언트·리소스 서버 역할**을 AirMCP가 수행 가능하게.
2. **RFC 8707 Resource Indicators**를 받아들여 토큰 audience를 검증.
3. 기존 Bearer 모드는 **하위 호환**으로 유지(레거시 `AIRMCP_HTTP_TOKEN` 구성은 v3.0까지 동작).
4. `.well-known/oauth-protected-resource` 엔드포인트 추가로 **자동 탐색** 지원.
5. 로컬·개인 사용자는 설정 복잡도가 늘지 않도록 디폴트는 기존과 동일(loopback + optional token).

### Non-goals (이 RFC 범위 밖)

- AirMCP 자체가 **AS 역할**을 할지 여부. 1단계는 외부 AS(Keycloak·Auth0·Hydra·Supabase 등) 위임만 목표.
- 사용자 관리·그룹·RBAC. 이는 토큰의 scope·claim에 포함되어 들어오는 것으로 족하다.
- iOS 위젯·Swift 앱의 쿠키 흐름.

---

## 3. Design

### 3.1 네트워크 정책 enum 확장

`src/server/allow-network-policy.ts`의 `NetworkPolicy` 유니온을 확장:

```ts
export type NetworkPolicy =
  | "loopback-only"
  | "with-token"                 // legacy Bearer (현행)
  | "with-token+origin"
  | "with-oauth"                 // NEW — OAuth 2.1 + RI
  | "with-oauth+origin"          // NEW — OAuth + CORS allow-list
  | "unauthenticated";
```

`with-oauth` 선택 시 시작 불변식(RFC 0002의 패턴 재사용):
- `AIRMCP_OAUTH_ISSUER` 필수 (예: `https://auth.example.com/realms/airmcp`)
- `AIRMCP_OAUTH_AUDIENCE` 필수 (= RFC 8707 target resource URI, 예: `https://airmcp.local/mcp`)
- 빠진 값이 있으면 시작 거부 (`validateNetworkPolicy`).

### 3.2 토큰 검증 파이프라인

```
Authorization: Bearer <JWT>
    ↓
verifyJWT(token, {
  issuer: AIRMCP_OAUTH_ISSUER,   // iss 검증
  audience: AIRMCP_OAUTH_AUDIENCE, // aud 검증 (RFC 8707)
  algorithms: ["RS256", "ES256"],  // 대칭키 금지
})
    ↓
claims = { sub, scope, exp, iat, resource?, ... }
    ↓
req.oauth = { subject, scopes, raw }
    ↓
미들웨어: destructive 도구 호출 시 scope 체크 (선택)
```

- JWKS는 `${issuer}/.well-known/jwks.json`에서 **프로세스 시작 시 1회 fetch + 캐시 + 10분 주기 백그라운드 갱신**. kid 회전 대응.
- Resource Indicators 검증: `aud` claim이 `AIRMCP_OAUTH_AUDIENCE`를 **포함**하지 않으면 401. 토큰에 `resource` claim이 있다면 그 값도 audience와 매칭해야 통과(spec draft가 `aud`·`resource` 둘 다 언급하므로 둘 중 하나라도 매치되면 통과하도록 폴백).

### 3.3 발견(discovery) 엔드포인트

- `GET /.well-known/oauth-protected-resource` (RFC 9728):
  ```json
  {
    "resource": "https://airmcp.local/mcp",
    "authorization_servers": ["https://auth.example.com/realms/airmcp"],
    "bearer_methods_supported": ["header"],
    "resource_signing_alg_values_supported": ["RS256", "ES256"]
  }
  ```
- `.well-known/mcp.json`의 `authorization` 필드 확장:
  ```json
  {
    "authorization": {
      "type": "oauth2",
      "resource": "https://airmcp.local/mcp",
      "authorization_servers": ["https://auth.example.com/realms/airmcp"],
      "scopes_supported": ["mcp:read", "mcp:write", "mcp:destructive"]
    }
  }
  ```

### 3.4 scope 설계 (제안, v2.11 bake-in 대상 아님)

| scope | 허용 도구 |
|---|---|
| `mcp:read` | `readOnlyHint: true`인 모든 도구 |
| `mcp:write` | `readOnlyHint: false` + `destructiveHint: false` |
| `mcp:destructive` | `destructiveHint: true` (기본 HITL 경로와 AND) |
| `mcp:admin` | `audit_*`, `memory_forget`, `setup_permissions` 등 메타 |

구현 1단계에서는 **scope 강제는 하지 않고 payload에 실어두기만**. 2단계에서 `tool-registry.ts`의 pre-handler gate에 scope 체크 삽입.

### 3.5 하위 호환성

- `AIRMCP_HTTP_TOKEN`이 설정된 상태에서 `AIRMCP_OAUTH_ISSUER`도 설정되면 **둘 다 받아들임** (토큰이 JWT 시그니처 파싱 성공하면 OAuth 경로, 실패하면 Bearer 경로). 이중 경로는 v3.0까지만 유지.
- 모든 새 플래그·env var는 기본 off. 기존 deployments는 변경 없이 동작.

---

## 4. Risks / Open Questions

### R1. JWKS fetch 실패 시 부팅
- **위험**: 네트워크 단절·AS 장애 상태에서 서버 부팅 실패 → AirMCP는 로컬 도구 접근이 목적인데 외부 서비스 가용성에 종속.
- **대응**: 부팅 시 JWKS를 **필수 fetch가 아니라 lazy**로 전환. 첫 요청 때 실패하면 503 반환하되, AS 복구 후 자동 재시도. `doctor`에 AS 헬스 체크 표출.

### R2. 시계 동기화 (clock skew)
- **위험**: `exp`/`nbf` 검증이 호스트 시계에 민감. Mac 시계가 조금만 흘러도 401 남발.
- **대응**: `clockTolerance: 60` (60초) 허용. 이보다 넓히면 보안 희석 위험.

### R3. 토큰 교환(Token Exchange) 표준 (RFC 8693) 통합 여부
- Managed Agents는 AirMCP 토큰을 받아 downstream MCP 서버에 제시할 때 token exchange가 필요할 수 있다.
- **1단계에서는 out of scope**. 2단계 RFC에서 재검토.

### R4. 공격 표면 증가
- JWT 파서·JWKS fetcher 도입은 이론적 공격 표면 증가. `jose` (DOS/시그니처 견고성 검증된 라이브러리) 사용 + `algorithms` allow-list로 `none` 알고리즘 취약점 회피.

### R5. 로컬 개발자 UX
- **위험**: 개발자가 OAuth AS를 로컬에 띄워야 하는 부담.
- **대응**: `dev:oauth` 스크립트 하나로 Keycloak devcontainer 기동. 디폴트 realm·client·user 자동 생성. 문서에 **"로컬 개발은 `AIRMCP_HTTP_TOKEN` 유지 권장"** 명시.

---

## 5. Rollout

| 단계 | 내용 | 버전 |
|---|---|---|
| 1 | `NetworkPolicy` enum 확장, `validateNetworkPolicy` 가드, `.well-known/oauth-protected-resource` 엔드포인트, `jose` 의존성, JWKS 캐시, 검증 미들웨어. **scope 강제 없음**. | v2.11.0 |
| 2 | `tool-registry.ts` pre-handler에 scope 체크 삽입. `mcp:destructive` 없이 destructive 호출 시 403. | v2.12.0 |
| 3 | 브라우저 MCP 클라이언트 대상 PKCE 플로우 가이드 문서 업데이트. | v2.12.0 |
| 4 | `AIRMCP_HTTP_TOKEN` 경로 deprecation warning. | v2.13.0 |
| 5 | `AIRMCP_HTTP_TOKEN` 제거. OAuth만 지원. | v3.0.0 |

---

## 6. KPIs / Acceptance Criteria

- `doctor`의 HTTP policy 섹션이 OAuth 모드에서 `issuer`·`audience`·JWKS 최신 kid 요약을 출력.
- `with-oauth` 모드에서 유효 JWT로 `list_tools` 호출 가능, 만료·잘못된 `aud`·잘못된 `iss` 토큰은 각각 401.
- `with-token` (레거시) 경로 테스트 91개 전원 green 유지.
- `npm audit --omit=dev` 0건 유지 (`jose` 포함).
- E2E 테스트: Keycloak devcontainer 기동 → 클라이언트가 authorization code + PKCE로 토큰 획득 → AirMCP에 제시 → 툴 호출 성공 1종.

---

## 7. Alternatives Considered

- **mTLS (client cert)**: 로컬 개발 UX가 최악. Managed Agents 생태계가 채택하지 않는 방향. 기각.
- **HMAC 서명된 요청 (AWS SigV4 스타일)**: 토큰 만료·회수 측면은 해결하지만 MCP 생태계가 OAuth로 수렴. Single-sourcing 원칙. 기각.
- **OAuth 2.0** (레거시): implicit flow·암묵적 토큰 만료 관례 등으로 보안 weak. 2025-06-18 spec이 **2.1 명시**. 기각.

---

## 8. References

- [MCP 2025-06-18 Authorization Spec](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [RFC 8707: Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728)
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)
- QUALITY_DIAGNOSIS_2026-04-17 HIGH-3 (공개 HTTP 배포 실수 경로)
- RFC 0002 (HTTP `allowNetwork` 정책)
