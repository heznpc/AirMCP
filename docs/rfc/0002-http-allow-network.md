# RFC 0002 — Declarative HTTP `allowNetwork` Mode

- **Status**: Draft
- **Author**: 두콩 + Claude
- **Created**: 2026-04-17
- **Target**: v2.8.0 (guard) → v2.9.0 (OAuth 2.1 완성)
- **Related**: `src/server/http-transport.ts`, `CHANGELOG v2.5.2` (`--bind-all` 무인증 차단), `TODO.md` P2 (OAuth 2.1 + PKCE)

---

## 1. Motivation

현재 AirMCP HTTP 모드는 다음 경로에서 작동한다:

| 케이스 | 바인딩 | 토큰 | 현재 동작 | 리스크 |
|---|---|---|---|---|
| A | loopback (기본) | 없음 | 정상 시작 | 낮음 (로컬만 접근 가능) |
| B | loopback (기본) | 있음 | 정상 시작, 인증 요구 | 낮음 |
| C | `--bind-all` | 있음 | 정상 시작, 인증 요구 | 중간 (토큰 관리 필요) |
| D | `--bind-all` | 없음 | **FATAL 종료** (v2.5.2에서 추가) | 차단됨 ✅ |

문제는 **케이스 A의 확장 사고 경로**다:

1. 운영자가 `loopback`으로 시작한 AirMCP 앞에 reverse proxy(Caddy/Nginx/Traefik)를 둔다.
2. 프록시 설정 실수(listen 0.0.0.0, TLS 없이 노출)로 인해 AirMCP가 **실질적으로 공개된다**.
3. AirMCP 입장에서는 요청이 127.0.0.1에서 오므로 인증을 요구하지 않는다.
4. 공격자가 262 툴(파일 시스템, 메시지, 이메일 송신 등)에 **무인증**으로 접근.

현재는 이 사고를 **운영자의 주의력**에 의존한다. 서비스화 맥락에서는 받아들일 수 없다.

**목표**: 네트워크 노출 정책을 **선언적으로** 표현하고, AirMCP가 기동 시 **명시적 의도 없이는 외부 노출 경로를 허용하지 않도록** 한다.

---

## 2. Proposed Design

### 2.1 `allowNetwork` 선언형 모드

`allowNetwork`는 AirMCP HTTP 서버를 **누가 inbound로 호출할 수 있는지** 정하는 노출 정책이다. 외부 API 호출을 제한하는 outbound egress allow-list가 아니다.

config.json 또는 환경변수 `AIRMCP_ALLOW_NETWORK`:

```jsonc
{
  "http": {
    "allowNetwork": "loopback-only" // 기본값
    //              "with-token"        — 외부 바인딩 허용, 토큰 필수
    //              "with-token+origin" — 외부 바인딩 허용, 토큰 + Origin 화이트리스트 필수
    //              "unauthenticated"   — 명시적 위험 모드 (CI 테스트·디버그 전용)
  }
}
```

CLI 플래그 대응:

| CLI | 해석 |
|---|---|
| (없음) | `loopback-only` |
| `--bind-all` | `with-token` (기존 동작과 호환) |
| `--bind-all --allow-origin=https://foo.com` | `with-token+origin` |
| `--bind-all --unsafe-no-auth` | `unauthenticated` (stderr 경고 + `.well-known/mcp.json`에 `security: insecure` 플래그) |

### 2.2 시작 시 Invariant 검증

`src/server/http-transport.ts` 진입점에서:

```ts
function validateNetworkPolicy(cfg: ResolvedHttpConfig): void {
  const { bindAll, token, allowedOrigins, allowNetwork } = cfg;

  switch (allowNetwork) {
    case 'loopback-only':
      if (bindAll) {
        fatalExit(
          'allowNetwork=loopback-only conflicts with --bind-all. ' +
          'Choose one: remove --bind-all, or set allowNetwork to "with-token".',
        );
      }
      break;

    case 'with-token':
      if (!token) {
        fatalExit(
          'allowNetwork=with-token requires AIRMCP_HTTP_TOKEN. ' +
          'Set the token or switch to allowNetwork=loopback-only.',
        );
      }
      break;

    case 'with-token+origin':
      if (!token) fatalExit('…requires AIRMCP_HTTP_TOKEN.');
      if (allowedOrigins.length === 0) {
        fatalExit(
          'allowNetwork=with-token+origin requires AIRMCP_ALLOWED_ORIGINS. ' +
          'Example: AIRMCP_ALLOWED_ORIGINS="https://claude.ai,https://cursor.sh"',
        );
      }
      break;

    case 'unauthenticated':
      console.error(
        '⚠️  allowNetwork=unauthenticated — tool surface is exposed without auth. ' +
        'This mode is intended for CI/debug only. ' +
        'Public deployments in this mode are a security incident.',
      );
      break;
  }
}
```

### 2.3 런타임 “프록시 감지” 힌트 (soft warning)

localhost 바인딩이라도 다음 시그널이 있으면 경고:

- `X-Forwarded-For` / `X-Forwarded-Host` / `X-Real-IP` 헤더 수신 → "AirMCP가 프록시 뒤에서 운영되는 것으로 보입니다. 공개 노출이라면 `allowNetwork=with-token`으로 승격하세요."
- `Host` 헤더가 `localhost`/`127.0.0.1`이 아닌 경우 → 동일 경고
- 경고는 **최초 1회만** (세션당) stderr + audit 로그. 무한 경고 방지.

### 2.4 `airmcp doctor` 통합

```
$ npx airmcp doctor

[HTTP]
  mode             : with-token
  bind             : 0.0.0.0:3847
  token            : set (sha256: 7b3a…)
  origins          : https://claude.ai
  session TTL      : 30m (default)
  rate limit       : 120 req/min
  ✅ Policy: with-token — external exposure allowed with auth

  [!] Detected X-Forwarded-For headers in last 100 requests.
      If behind a reverse proxy, verify the proxy terminates TLS and rejects
      unauthenticated requests at the edge as well.
```

### 2.5 `.well-known/mcp.json` 반영

`authorization` 블록에 `network_policy`:

```json
{
  "authorization": {
    "type": "bearer",
    "network_policy": "with-token+origin",
    "allowed_origins": ["https://claude.ai"]
  }
}
```

Managed Agents·디스커버리 클라이언트가 정책을 사전에 확인 가능.

---

## 3. Migration Plan

| 단계 | 작업 | 버전 | 호환성 |
|---|---|---|---|
| 1 | `allowNetwork` 필드 추가, 기본값 `loopback-only`, 기존 `--bind-all` 동작은 **암묵적으로 `with-token`** 매핑 | v2.8.0 | ✅ 비파괴 |
| 2 | 시작 시 invariant 검증, 위반 시 fatal | v2.8.0 | ⚠️ 잘못 설정된 배포는 기동 실패 (의도된 동작) |
| 3 | `doctor`·config 검증 경고 | v2.8.0 | — |
| 4 | 프록시 감지 런타임 경고 | v2.8.1 | — |
| 5 | `.well-known/mcp.json` 확장 | v2.8.1 | 선택 필드 |
| 6 | OAuth 2.1 + PKCE 모드(`allowNetwork=oauth`) 도입 | v2.9.0 | 추가 모드 |
| 7 | `--bind-all` 플래그 deprecation 경고 (선언형 config 권장) | v2.9.0 | 비파괴 |

**Breaking 여부**: 신규 config 키는 기본값이 `loopback-only`이지만 **기존 `--bind-all + 토큰` 경로는 `with-token`으로 자동 매핑**되므로 실질적 파괴는 없다. `--bind-all` 단독(토큰 없음)은 이미 v2.5.2에서 fatal이므로 변경 없음.

---

## 4. Alternatives Considered

### 4.1 모든 것을 `--bind-all`·`--token` 플래그 조합으로만 둔다 (현상 유지)
- 장점: 단순
- 단점: 프록시 사고 경로 방어 불가. `--bind-all`은 네트워크 바인딩의 존재를 말할 뿐 **정책 의도**를 말하지 않는다.

### 4.2 `--strict-network` / `--lax-network` 부울 플래그
- 2개 상태는 표현력이 부족. origin whitelist·OAuth 같은 미래 확장에 재설계 필요.

### 4.3 mTLS 필수화
- 보안 강도는 최상. 단, 개인 사용자·노트북 환경에서 인증서 관리 비용이 과도. enterprise tier(향후)에 옵션으로 남겨둔다.

### 4.4 선언형 모드 + 프록시 헤더 신뢰
- `X-Forwarded-For`를 "외부 접근 있음"으로 간주하고 토큰 요구. 그러나 **신뢰할 수 없는 프록시**(설정 실수)가 이 헤더를 전달하지 않을 수 있어 false negative 가능. 정책 선언형이 더 엄격하다.

---

## 5. Open Questions

1. **`unauthenticated` 모드를 제공할 가치가 있는가?** CI 환경·로컬 fuzz 테스트에서는 편하지만, 잘못 사용될 위험. 제안: stdout/stderr에 큰 경고 + `.well-known/mcp.json` `security: insecure` 공개 + audit 로그 매 요청 기록.
2. **`Origin` 헤더가 없는 요청(예: curl, 네이티브 MCP 클라이언트)은?** **기본 허용 — 해결됨.** 브라우저는 cross-origin 요청에 항상 `Origin`을 붙이므로 `Origin` 부재는 브라우저발 CSRF/DNS-rebinding이 아니라 비-브라우저 클라이언트를 뜻하며, 이들은 이미 토큰/OAuth 정책으로 게이트된다. 기본 거부는 정당한 로컬 클라이언트를 보안 이득 없이 깨므로 채택하지 않았다. 브라우저 전용 배포를 위한 엄격 모드는 `AIRMCP_DENY_NO_ORIGIN=1`로 opt-in. (이 문서 초안이 적었던 `AIRMCP_TRUST_NO_ORIGIN`(기본 거부 전제)은 구현된 적이 없고, 실제 기본값은 허용이다 — `src/server/http-transport.ts: isOriginAllowed`.)
3. **CIDR allow-list까지 가야 하는가?** 필요 시 v2.9.0 `trustedNetworks: ["10.0.0.0/8"]` 형태로 추가. 초기 스코프 아님.
4. **`--bind-all`의 IPv6 대응**: 현재 IPv4만 고려. `::` 바인딩도 동일 정책 적용해야 함. 구현 시점에 확인.

---

## 6. Success Metrics

- "토큰 없이 `--bind-all` 사고" 재현 시도 → **0건** (기존대로 차단 유지)
- 프록시 배후 경로 경고 → 최초 감지 후 **100%** stderr 노출
- `doctor`가 HTTP 정책을 명시적으로 리포트 → 모든 HTTP 모드 시작에서 보임
- OAuth 2.1 도입 시점에 추가 invariant 없이 `allowNetwork` enum 확장만으로 대응 가능

---

## 7. Next Steps

1. 본 RFC 리뷰·승인
2. `http-transport.ts`에 `allowNetwork` 파싱 + invariant 검증 PR
3. `doctor` 정책 리포트 + 프록시 헤더 감지 PR
4. `.well-known/mcp.json` 스키마 확장 PR
5. README·docs/site 에 배포 패턴 4종(로컬·프록시+토큰·오리진 화이트리스트·OAuth) 문서화
