# RFC 0001 — Error Categories & Tool Error Contract

- **Status**: Accepted — Foundation + Waves 0/1 shipped in v2.10.0; remaining module migration (Wave 2+) in progress
- **Author**: 두콩 + Claude
- **Created**: 2026-04-17
- **Target**: v2.8.0 (foundation) · v2.12.0+ (remaining modules)
- **Related**: `src/shared/result.ts`, `src/shared/jxa.ts`, `src/shared/swift.ts`, MCP SDK `outputSchema`

---

## 1. Motivation

현재 AirMCP는 툴 실패를 대부분 `err(message)` 또는 `toolError(action, e)`를 통해 `{ content: [...], isError: true }`로 반환한다. 이 shape는 MCP 프로토콜 수준에서는 맞지만, **에이전트가 실패 원인별로 적절한 리커버리 전략을 선택하기에는 정보가 부족**하다.

구체적 문제:

1. Zod 입력 검증 실패·JXA 통신 실패·macOS 권한 거부·원격 API 타임아웃이 모두 동일한 free-form 문자열로 귀결되어, LLM은 패턴 매칭으로만 구분할 수 있다.
2. 일부 툴은 `[not_found]`·`[internal_error]` prefix를 쓰지만 **모듈·저자마다 컨벤션이 다르다**. prefix 없는 툴이 다수다.
3. `outputSchema`가 선언된 29개 툴조차 **에러 응답의 shape가 성공 응답과 다르다**. 클라이언트 구현이 두 갈래 파싱을 해야 한다.
4. HITL 거부·타임아웃·deprecation 등 **“의도된 실패”가 일반 에러와 섞여** 에이전트가 재시도해야 할지 포기해야 할지 판단하기 어렵다.

**목표**: 에이전트가 실패를 **카테고리 단위로** 소비할 수 있도록, 툴 응답 실패 shape를 표준화한다.

---

## 2. Proposed Design

### 2.1 Error Category Enum

`src/shared/error-categories.ts` (신규):

```ts
export const ERROR_CATEGORIES = {
  INVALID_INPUT: 'invalid_input',     // Zod 실패, 스키마 불일치, 형식 오류
  NOT_FOUND: 'not_found',             // 대상 리소스 존재하지 않음
  PERMISSION_DENIED: 'permission_denied', // macOS 권한, HITL 거부, 토큰 부족
  HITL_TIMEOUT: 'hitl_timeout',       // 사용자 승인 대기 타임아웃
  UPSTREAM_ERROR: 'upstream_error',   // 외부 서비스(Gemini·Open-Meteo·GWS) 오류
  UPSTREAM_TIMEOUT: 'upstream_timeout', // 외부 호출 타임아웃
  JXA_ERROR: 'jxa_error',             // osascript 실패, 앱 응답 없음
  SWIFT_ERROR: 'swift_error',         // Swift 브리지 실패
  RATE_LIMITED: 'rate_limited',       // 내부 또는 외부 rate limit
  DEPRECATED: 'deprecated',           // 제거 예정 툴 호출 (예: add_bookmark)
  UNSUPPORTED_OS: 'unsupported_os',   // macOS 버전 불일치 (Podcasts/Intelligence 등)
  INTERNAL_ERROR: 'internal_error',   // 위 카테고리에 속하지 않는 예외
} as const;

export type ErrorCategory =
  (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES];
```

### 2.2 Structured Error Payload

MCP 사양은 `isError: true`에서도 `content`·`structuredContent` 병행 가능. 다음 shape를 표준화:

```ts
export interface ToolErrorPayload {
  category: ErrorCategory;
  message: string;          // human-readable, PII 스크러빙 후
  retryable: boolean;       // 에이전트가 재시도해야 하는지 힌트
  retryAfterMs?: number;    // rate_limited/upstream_timeout일 때
  hint?: string;            // 다음 행동 힌트 ("use add_to_reading_list instead")
  cause?: {                 // 디버그용, 기본 비노출
    code?: string | number; // JXA -1743, macOS errno
    origin?: string;        // 'jxa' | 'swift' | 'gws' | 'gemini' | …
  };
}
```

**텍스트 content**는 기존과 동일하게 유지(백워드 호환):

```json
{
  "content": [{ "type": "text", "text": "[not_found] Note 'Meeting notes' does not exist" }],
  "structuredContent": {
    "error": {
      "category": "not_found",
      "message": "Note 'Meeting notes' does not exist",
      "retryable": false,
      "hint": "Use list_notes to see available notes"
    }
  },
  "isError": true
}
```

### 2.3 Helper Surface

`src/shared/result.ts` 확장:

```ts
export function toolErr(
  category: ErrorCategory,
  message: string,
  opts?: Omit<ToolErrorPayload, 'category' | 'message'>,
): ToolResult;

// 편의 헬퍼
export const errInvalidInput   = (m: string, hint?: string) => toolErr('invalid_input', m, { retryable: false, hint });
export const errNotFound       = (m: string, hint?: string) => toolErr('not_found', m, { retryable: false, hint });
export const errPermission     = (m: string, hint?: string) => toolErr('permission_denied', m, { retryable: false, hint });
export const errUpstream       = (m: string, retryAfterMs?: number) => toolErr('upstream_error', m, { retryable: true, retryAfterMs });
export const errJxa            = (m: string, code?: string) => toolErr('jxa_error', m, { retryable: true, cause: { code, origin: 'jxa' } });
export const errDeprecated     = (m: string, hint?: string) => toolErr('deprecated', m, { retryable: false, hint });
export const errUnsupportedOS  = (m: string, required: string) => toolErr('unsupported_os', m, { retryable: false, hint: `Requires ${required}` });
```

### 2.4 기존 `toolError(action, e)` 자동 분류 확장

현 구현은 "not found" 문자열만 인식. 확장:

| 감지 패턴 | 매핑 |
|---|---|
| Zod error instance | `invalid_input` |
| `no such` / `not exist` / `cannot find` / `-1728` | `not_found` |
| `not authorized` / `permission` / `-1743` | `permission_denied` |
| `AbortError` / `timeout` | `upstream_timeout` (외부) 또는 `jxa_error` (내부) |
| `ECONNREFUSED` / `ENOTFOUND` | `upstream_error` |
| JXA error codes -600, -1712 | `jxa_error` |

---

## 3. Migration Plan

v2.8.0에서 **추가적(additive)**으로 도입 후, v2.9.0에서 일부 prefix 문자열을 제거한다. **기존 `err()`·`toolError()` 호출은 그대로 유지**하고 내부적으로 새 shape로 wrapping.

| 단계 | 작업 | 소요 |
|---|---|---|
| 1 | `error-categories.ts` + 헬퍼 추가, 단위 테스트 | 1일 |
| 2 | `toolError()` 자동 분류 로직 확장 (모든 툴 자동 수혜) | 1일 |
| 3 | Wave 1 모듈(Notes/Reminders/Calendar/Mail/Finder/Safari) 명시적 에러 분류 전환 | 2~3일 |
| 4 | outputSchema Wave 1과 결합: 에러 shape를 각 툴의 outputSchema에 공식화 | 병행 |
| 5 | deprecated 툴(`add_bookmark`)을 `errDeprecated`로 전환, macOS 버전 가드 걸린 툴은 `errUnsupportedOS` | 0.5일 |
| 6 | CHANGELOG에 "툴 에러 shape 확장 (백워드 호환)" 명시 | — |

**Breaking 여부**: 없음. `content[0].text`는 기존과 동일 포맷 유지. `structuredContent.error`는 신규 선택 필드. MCP SDK 계약 상 unknown 필드 허용.

---

## 4. Alternatives Considered

### 4.1 MCP 표준 에러 타입만 사용
MCP 프로토콜 `-32xxx` JSON-RPC 에러 코드는 transport 수준이지 tool 수준이 아니다. tool 결과의 `isError: true`는 여전히 free-form이다. 이 방안은 문제를 해결하지 못한다.

### 4.2 HTTP 상태 코드 유사 체계 (400/404/500…)
숫자 코드는 에이전트가 학습하기 번거롭다. 카테고리 문자열이 LLM 친화적.

### 4.3 에러 shape를 Zod 타입으로만 표현 (도메인 특화)
모듈별 에러 시그니처 상이 → 에이전트가 일반화 불가. **카테고리는 cross-cutting concern**이므로 전역 enum이 맞다.

### 4.4 RFC 7807 Problem Details (`type`/`title`/`detail`/`instance`)
훌륭한 참고지만 웹 API 중심. MCP tool은 IRI `type` URI 같은 것이 과하다. RFC 7807의 `type`·`title`·`detail` 3개만 축약하면 본 설계와 거의 동형.

---

## 5. Open Questions

1. **`retryable: true`일 때 에이전트가 자동 재시도해야 하는가?** 클라이언트 정책. MCP SDK에 힌트는 있지만 강제는 아니다. Claude Managed Agents 관점에서 추가 규칙 필요.
2. **`cause.code`는 기본 포함 vs 환경변수로 토글?** 디버그 정보이므로 프로덕션에서 노출 최소화가 바람직. 제안: `AIRMCP_VERBOSE_ERRORS=true`일 때만 포함.
3. **i18n**: `message`는 현재 영어 기본. 로케일별 에러 메시지 테이블로 확장할지, LLM에 맡길지.
4. **audit 로그에도 `category` 기록?** Yes. 운영 지표(툴별 실패율, 실패 원인 Top-N)를 뽑기 위해 필수.

---

## 6. Success Metrics

- 에이전트 재시도 루프 감소: Notes/Reminders/Calendar에서 `jxa_error` 자동 재시도 성공률 ≥ 50%
- 에이전트 체이닝 중단 감소: `not_found` 대비 `invalid_input` 구분 후, "다음 툴 호출" 대신 사용자 재질문 비율 상승
- 진단 가능성: `airmcp doctor --audit-summary`에서 카테고리별 실패율 분포 표시 가능

---

## 7. Next Steps

1. 본 RFC 리뷰·승인
2. `error-categories.ts` + 헬퍼 + 테스트 PR
3. `toolError()` 자동 분류 확장 PR
4. Wave 1 모듈 전환 PR (outputSchema Wave 1과 결합)
5. 문서화: CONTRIBUTING.md에 "새 툴을 만들 때 에러 카테고리 가이드" 섹션 추가
