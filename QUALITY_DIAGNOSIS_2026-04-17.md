# AirMCP 품질·안정성 진단 보고서

- **기준 버전**: v2.7.3 (2026-04-16 릴리스)
- **작성일**: 2026-04-17
- **스코프**: 제품 품질·안정성 축 (배포/마케팅·신규 기능·수익화는 별도)
- **방법**: 레포 전수 정적 분석 + 테스트·CI 구성 확인 + CHANGELOG/TODO 대조

---

## §0 갱신 (2026-05-12, v2.12.0 기준) — 권고 9개 중 7개 해결

이 본문은 v2.7.3 스냅숏이며 역사 자료로 보존한다. 후속 8 minor 릴리스가 본문 권고를 어떻게 닫았는지의 *delta만* 아래 표에 기록한다.

| 본문 권고 | 상태 (2026-05-12) | 근거 |
|---|---|---|
| **HIGH-1** outputSchema 10% (29/278) | 🟢 **부분 해결**, 24% (71/301) | Wave 1-7 출하. 다음 Wave 8 후보: system 19 + music 14 + shortcuts 8 = 41 untyped, 그 중 *읽기/idempotent만* 추려 ~15-20 |
| **HIGH-2** TODO.md ↔ CHANGELOG 드리프트 | 🟢 **해결** | 본 갱신 PR로 TODO.md v2.7.3 → v2.12.0 동기화 + airmcp-direction.md 숫자 refresh |
| **HIGH-3** 공개 HTTP 배포 실수 경로 | 🟢 **해결** | OAuth 2.1 + PKCE + Resource Indicators (RFC 0005 Step 1+2) 출하, `.well-known/oauth-protected-resource` SEP-985/RFC 9728 정합 |
| **HIGH-4** macOS 26 블라스트 반경 감춰짐 | 🟢 **해결** | RFC 0004 `resolveModuleCompatibility` + `brokenOn`/`maxMacosVersion` 게이트 출하. Safari `add_bookmark`은 macOS 26+에서 등록 자체 스킵. Podcasts 모듈도 macOS 26에서 등록 스킵 |
| **MEDIUM-1** mcp-setup.ts 통합 테스트 얇음 | 🔴 **여전히 열림** — 441 LOC unguarded. **WWDC 6/8 전 반드시 처리** (6/8 reposition 코드 진입점이므로) |
| **MEDIUM-2** 직접 deps 버전 핀 느슨 | 🟡 **부분** | `zod ~` 적용. `express ^5.2.1`, `yaml ^2.8.4`, `jose ^6.2.3` 셋은 여전히 caret. 본 갱신 PR에 함께 처리 |
| **MEDIUM-3** Hono 트랜시티브 취약점 | 🟢 **해결** | `package.json overrides`로 `hono@^4.12.13` + `@hono/node-server@^1.19.13` 강제. `npm audit --omit=dev` 0 findings |
| **MEDIUM-4** 에러 shape 계약 부재 | 🟢 **해결** | RFC 0001 Wave 1-2 출하. 13 모듈 59 사이트가 `errPermission`/`errInvalidInput`/`errNotFound`/`errUpstream`/`errSwift`/`errDeprecated` 타입드 헬퍼 사용. `structuredContent.error.category` 컨트랙트 안정화 |
| **MEDIUM-5** Swift 브리지 관측성 | 🟢 **부분 해결** | `doctor --deep` + correlation id가 error envelope에 노출. `--diagnostics` 서브커맨드는 아직 없음 |
| **LOW-1** Zod outputSchema 필드 설명 | 🟡 **진행 중** | Wave별로 점진 |
| **LOW-2** 중국어 로케일 byte | ❓ **재측정 필요** | i18n CI artifact는 아직 안 올림 |
| **LOW-3** CI audit 등급 high-only | 🟢 **부분 해결** | overrides로 moderate 차단. 등급 단계적 상향은 미진행 |

**요지**: HIGH 4개 중 4개 해결, MEDIUM 5개 중 4개 해결, 1개(mcp-setup 테스트) 시급. *이 한 가지가 6/8 WWDC reposition 코드 추가 시 가장 깨지기 쉬운 진입점.*

신규 진단은 별도 파일 `QUALITY_DIAGNOSIS_2026-05.md`로 분리 권장 (작성 시점 미정).

---

## TL;DR — 3줄 결론

1. **v2.7.3는 이미 production-ready에 가깝다.** 262개 툴이 모듈 패턴으로 잘 나뉘어 있고, JXA escaping·circuit breaker·HITL·audit·PII 스크러빙 같은 “서비스 운영에서 실제로 아프게 만드는 것들”이 대부분 이미 중앙화되어 있다. v2.7.2에서 테스트 커버리지를 36.1% → 46.9%로 끌어올린 것은 품질 축의 변곡점이다.
2. **그럼에도 “서비스”로 도약하려면 품질의 정의를 코드에서 ‘계약’으로 옮겨야 한다.** 현재 공개 계약(outputSchema, 에러 shape, SemVer 정책, macOS 버전 매트릭스)이 툴 단위로 일관되지 않는다. outputSchema 커버리지가 **29/278 ≈ 10%**에 머물러 있고, 운영 대시보드·SLO도 없다.
3. **가장 큰 숨은 리스크는 ‘문서·코드 드리프트’다.** TODO.md는 v2.7.2에서 이미 해결된 테스트 항목(tool-registry 3%→80%, swift 10%→95%, hitl 100%, executor 99%, skills 99%)을 여전히 미결로 표시한다. 외부 기여자와 사용자가 보는 진실이 두 벌이다.

---

## 1. 성숙도 스냅샷 (검증된 수치만)

| 항목 | 값 | 검증 방법 |
|---|---|---|
| 버전 | 2.7.3 | `package.json` |
| 릴리스 | 2026-04-16 | `CHANGELOG.md` |
| 소스 LOC (TS) | **22,988** | `find src -name "*.ts" \| xargs wc -l` |
| 소스 디렉토리 | 34개 (기능 모듈 27 + `shared/` `server/` `cli/` + 보조) | `ls -d src/*/` |
| 테스트 파일 | **80개** (`tests/*.test.js`) | `find tests -name "*.test.js"` |
| 테스트 블록 (describe/it/test) | **1,272개** | `grep -rE "^(describe|it|test)\s*\("` |
| Jest 커버리지 게이트 | statements 46 / branches 40 / functions 42 / lines 46 | `jest.config.js` |
| 실제 커버리지 (v2.7.2 시점) | **46.9%** | `CHANGELOG.md` |
| 툴 등록 호출 | **278건** | `grep registerTool\|server.tool\|addTool` |
| `destructiveHint: true` | **49건** | `grep destructiveHint` |
| `outputSchema:` 선언 | **29건 (13 파일)** | `grep outputSchema` |
| CI 워크플로 | 7개 (ci, cd, codeql, pages, scorecard, stale, auto-release) | `.github/workflows/` |
| 직접 런타임 의존성 | 5개 | `package.json` |
| HTTP 인증 | `AIRMCP_HTTP_TOKEN` — `--bind-all`엔 필수, 그 외 선택 | `src/server/http-transport.ts:112-136` |
| 라이선스 | MIT | `LICENSE` |
| i18n 로케일 | 9개 | `docs/locales/` |

---

## 2. 이미 잘 되어 있는 것 (유지·강화 대상)

### 2.1 JXA 안전망 — `src/shared/jxa.ts`
- 4슬롯 세마포어(`CONCURRENCY.JXA_SLOTS`) + per-app circuit breaker(closed/open/half-open) + 2회 재시도 + 30초 타임아웃 후 SIGKILL 그레이스 + PII 스크러빙(이메일/`/Users/*`) + JXA 에러코드(-1743, -1728…) → 친화적 메시지 매핑까지 한 파일에서 수행. 이 수준의 방어막은 애플 에코시스템 MCP에서 희소하다.
- `escAS()` `esc()` `escJxaShell()` 가 v2.7.2부터 `RE_CTRL` 공용 상수로 통합된 점 양호.

### 2.2 HITL + Audit — 기본값이 안전한 방향
- Destructive 툴 49개 모두 `destructiveHint: true` 선언 (`safety-annotations.test.js`가 전수 검증).
- Elicitation 우선 → 실패 시 소켓 HITL fallback. Claude 관리형 클라이언트는 이중 승인을 피하기 위해 elicitation 스킵. 이 분기 로직이 테스트 커버리지 100%인 점이 핵심.
- 모든 툴 호출은 `toolRegistry.installOn()`을 거쳐 audit 로그로 흐름. v2.7.1에서 `loadFromDisk`·`flush`·`flushSync`·타이머의 silent swallow를 `console.error`로 전환한 것이 실제 운영 시야를 크게 넓혔다.

### 2.3 시작/종료 회복력
- `index.ts`가 `--version`·`init`·`doctor`·`--help`를 무거운 import 전에 라우팅 → cold-start가 가벼움.
- 알 수 없는 서브커맨드 거부 (`npx airmcp typo` → 에러 종료). stdio/HTTP 혼동 사고를 차단.
- `SIGINT`/`SIGTERM`에서 `usageTracker.stop()` + `flushSync()`. TTY guard로 CI·Docker·파이프 환경 보호.

### 2.4 SemVer·릴리스 운영
- Keep-a-Changelog 포맷 준수, 릴리스 노트에 **“880 → 1121 tests, coverage 36.1 → 46.9%”** 처럼 수치를 박는 관행이 자리 잡음. 이것은 품질이 문화가 된 증거다.

### 2.5 CI 품질 게이트 (blocking)
- `ci.yml` 13단계: gitleaks → 대용량 파일 체크 → 라이선스 감사 → npm audit → npm signatures → lint → build → typecheck → test → stats 검증 → 버전 동기화 → i18n 검증 → Swift build+test. 대부분의 OSS가 이 중 절반도 막지 않는다.

---

## 3. 위험 매트릭스

HIGH = “서비스”로 키우는 길을 막는 것. MEDIUM = 다음 릴리스 2~4개 안에 갚아야 할 부채. LOW = 인지만.

### HIGH-1. outputSchema 커버리지 10%
- **증상**: 278개 툴 중 29개만 `outputSchema` 선언. 에이전트(Claude)가 결과를 **구조적으로** 소비하지 못하고 텍스트 파싱에 의존.
- **영향**: 체이닝·에이전트 워크플로 품질의 상한선을 결정. “62 → 162개”로 확장해도 에이전트 경험은 계단식으로 개선되지 않는다.
- **근거**: `grep -rE "outputSchema\s*:" src/ --include="*.ts" | wc -l` → 29.
- **권고**: P0 모듈(Notes/Reminders/Calendar/Mail/Finder/Safari/System 주요 read 툴) 먼저 outputSchema를 계약화. 각 툴에 `.describe()` 필드 설명도 함께. 이것이 “262 툴”이라는 마케팅 수치를 **실사용 가치**로 환산시키는 유일한 레버다.

### HIGH-2. 문서·코드 드리프트 (TODO.md ↔ CHANGELOG)
- **증상**: `TODO.md` P1이 `tool-registry.ts` `swift.ts` `hitl.ts` `executor.ts` 테스트를 아직 미완으로 표시하지만, `CHANGELOG.md` v2.7.2는 이미 해결됨을 명시(각각 80%, 95%, 100%, 99%).
- **영향**: (a) 외부 기여자가 “이미 해결된 이슈”에 PR 보냄 → 리뷰 비용 낭비. (b) 사용자가 프로젝트 현황을 과소평가. (c) 신규 기여자 온보딩 심리적 장벽.
- **권고**: TODO.md를 **단일 진실**로 유지하려면 릴리스 프로세스에 `docs/TODO.md` 자동 체크오프 훅 또는 릴리스 노트 생성 스크립트가 필요. 최소한 v2.7.3 릴리스 다음 커밋에서 수동으로 정리.

### HIGH-3. 공개 HTTP 배포 실수 경로
- **증상**: HTTP 모드는 `--bind-all` 시 `AIRMCP_HTTP_TOKEN`을 **강제**하지만(`http-transport.ts:136`), loopback 바인딩 + 토큰 미설정도 정상 경로. 운영자가 역프록시 뒤에 놓고 방화벽 규칙을 실수하면 애플 에코시스템 전체가 노출된다.
- **영향**: 단 한 건의 사고로 “보안이 약한 MCP”라는 영구 레이블이 붙는다.
- **권고**:
  - 기본적으로 `Mcp-Session-Id` 발급에 TTL/퍼주너리 만료 적용.
  - `allowNetwork: loopback-only | with-token` 같은 **선언적** 모드를 config에 두고, 둘 다 아닐 때는 시작 거부.
  - README·`doctor`에 “이 구성은 공개 노출 위험” 경고 뱃지를 도입.
  - OAuth 2.1 + PKCE(`TODO.md` P2) 우선순위를 P1으로 격상 고려.

### HIGH-4. macOS 26 블라스트 반경이 감춰져 있다
- **증상 1**: Safari `add_bookmark`는 여전히 등록되고 실행 시점에 에러를 반환한다 (`src/safari/tools.ts:260-278`). 에이전트 관점에선 “존재하지만 항상 실패”하는 툴이 존재.
- **증상 2**: Podcasts 모듈은 소스에 `deprecated`·`macos 26`·`unsupported` 주석이 없다(`grep` 확인됨). 그러나 `TODO.md`에는 “macOS 26+에서 JXA 딕셔너리 제거”가 명시. 즉 코드와 문서가 불일치.
- **영향**: Claude가 툴을 고르는 결정에서 “실패율 높은 툴”이 선별되지 못함 → 전체 에이전트 성공률이 희석.
- **권고**:
  - 모듈 manifest에 `minMacosVersion` / `maxMacosVersion` / `status: stable|deprecated|experimental` 선언을 표준화하고, 시작 시 호스트 OS 버전에 따라 **등록 자체를 스킵**.
  - `discover_tools`에서 사용자·에이전트에게 상태를 노출.
  - deprecated 툴은 제거일자를 명시한 경고와 함께 **다음 메이저(v3.0)에서 드랍** 스케줄 공표.

### MEDIUM-1. server/ 모듈의 통합 테스트 얇음
- **증상**: `tests/`에 `server-init.test.js`·`http-transport.test.js`는 있지만 `mcp-setup.ts` (441 LOC, 동적 모듈 로딩·HITL 설치·툴 레지스트리 주입의 교차점)의 실패 시나리오 테스트가 빈약.
- **영향**: 모듈 하나가 `import()`에서 예외를 던지면 전체 서버가 다운되는 조기 실패 분기가 실제 프로덕션에서는 재현되기 어렵다.
- **권고**: `mcp-setup.ts`에 대해 “한 모듈 로드 실패 시 나머지 모듈은 살아야 함”, “파워·HITL 설치 순서 invariants”, “모듈 필터(`AIRMCP_DEBUG_MODULES`) 경계값” 세 가지 블랙박스 시나리오만 먼저.

### MEDIUM-2. 직접 의존성 버전 핀 느슨
- **증상**: `express ^5.2.1`, `yaml ^8.2.2`. `zod`는 `~`(패치 락)으로 안전. `@modelcontextprotocol/sdk`·`@modelcontextprotocol/ext-apps`는 정확 고정.
- **영향**: 재현 가능한 릴리스를 `package-lock.json`에만 의존. `npm publish` 캐시 불일치 시나리오에서 빌드가 미묘하게 갈라진다.
- **권고**: 런타임 5개 모두 정확 고정. Renovate/Dependabot으로 주기적 강제 업데이트. devDependencies는 현행 유지 가능.

### MEDIUM-3. Transitive 취약점 (Hono 계열)
- **증상**: 직접 의존성에는 Hono가 없지만 `package-lock.json`에 `"hono"` 엔트리 2개(= 간접). 이전 리서치 단계에서 Hono 미들웨어 관련 moderate 등급 advisory가 언급됨.
- **영향**: `--http` 미사용 환경에서도 설치 타임에 경고 → `npm audit` 파이프라인이 주기적으로 붉어짐.
- **권고**: `npm ls hono`로 유입 경로 확인 후 (1) 해당 상위 의존성 버전 범프 또는 (2) `overrides`로 패치된 버전 강제. CI의 `npm audit` 단계가 moderate도 fail하도록 단계적 상향 고려.

### MEDIUM-4. 에러 shape의 “계약” 부재
- **증상**: 툴 실패 시 `err()`/`toolError()` 경유로 대부분 `{ content: [...], isError: true }`로 귀결되지만, 에러 코드 prefix(`[not_found]`, `[internal_error]`)가 일부 툴에서만 쓰이고, Zod 입력 검증 실패·JXA 통신 실패·권한 거부가 **클라이언트 측에서 구분되지 않는다**.
- **영향**: 에이전트가 실패 이유별로 적절한 리커버리(재시도·권한 안내·대체 툴)를 하지 못한다.
- **권고**: 에러 카테고리 enum(`INVALID_INPUT | NOT_FOUND | PERMISSION_DENIED | UPSTREAM_ERROR | TIMEOUT | DEPRECATED | UNSUPPORTED_OS`)을 정의하고 `outputSchema`에 `error` 분기 타입을 공식화.

### MEDIUM-5. Swift 브리지 관측성
- **증상**: `src/shared/swift.ts`는 v2.7.2에서 95% 커버리지까지 올라왔지만, Swift CLI 자체의 관측성(로그 레벨·크래시 덤프·버전 핑) 표면은 얇다.
- **영향**: Intelligence·Health·Photos 기능 장애 시 원인 특정이 어렵다.
- **권고**: Swift 바이너리에 `--selftest`·`--version`·`--diagnostics` 서브커맨드 표준화. `airmcp doctor`에서 자동 호출.

### LOW-1. Zod `outputSchema` 필드 설명 부재
- 입력은 대부분 `.describe()` 체인 있음. 출력은 거의 없음. outputSchema를 확대할 때 한 번에 해결할 것.

### LOW-2. 중국어 로케일 byte 수 하회 (zh-CN 97.7%, zh-TW 98.4%)
- i18n 키 누락 가능성. `check-i18n.mjs`의 콘솔 로그를 CI artifact로 업로드해 가시화.

### LOW-3. CI에서 `npm audit` 등급이 high-only
- moderate는 통과. 위 MEDIUM-3과 연결. 단계적 상향 계획이 있어야 “이미 알고 있는 문제”가 부채로 누적되지 않는다.

---

## 4. 품질을 ‘서비스 지표’로 변환하는 제안

현재 품질은 PR 단위의 내부 게이트로 관리된다. 서비스로 성장하려면 **사용자·에이전트 체감**을 수치화해야 한다.

| 지표 | 정의 | 목표 | 수집 방법 |
|---|---|---|---|
| 툴 성공률 (Tool Success Rate) | `success / (success + isError)` by tool, 7d 윈도 | 모듈 평균 ≥ 95%, 꼬리 ≥ 80% | 기존 audit 로그 집계 (opt-in) |
| p95 툴 레이턴시 | 호출당 p50/p95/p99 ms | p95 ≤ 1.5s(JXA), ≤ 3s(Swift) | audit에 `duration_ms` 이미 있음 |
| HITL 승인율 | destructive 툴 호출 중 승인 비율 | 60–80% (낮으면 UX 문제, 너무 높으면 가드 의미 없음) | hitl-guard 계측 |
| outputSchema 커버리지 | `tools_with_schema / total_tools` | 분기마다 +20%p | 정적 분석 |
| Startup cold-start | `airmcp init` 이후 첫 tools/list 응답까지 | ≤ 400ms p95 | CI 합성 측정 |
| Doctor 건강 점수 | `airmcp doctor`가 반환하는 pass/warn/fail | 배포 자격 게이트 | 기존 tool |
| macOS 호환성 매트릭스 | (모듈, macOS ver) 행렬의 pass 비율 | 26.0 / 26.1 / 24.x 3축 모두 95%+ | CI 매트릭스 |

---

## 5. 권고 — 우선순위 버킷

### P0 (다음 2주 안)
1. **TODO.md ↔ CHANGELOG 재동기화** — 반나절. 외부에 보이는 프로젝트 건강도를 가장 값싸게 올린다.
2. **outputSchema 커버리지 Wave 1** — Notes/Reminders/Calendar/Mail/Finder의 read·list·search 20개 툴에 도입. 에러 shape 계약 초안도 이때 같이.
3. **macOS 버전 매트릭스 선언** — 모듈 manifest에 `minMacosVersion`·`status` 도입, 시작 시 동적 등록 필터링. deprecated 툴(Safari `add_bookmark`) 제거 일정 공식화.

### P1 (v2.8.x)
4. **에러 카테고리 표준화** — enum + Zod 스키마 + `toolError` 리팩토링.
5. **HTTP 배포 가드 강화** — `allowNetwork` 선언적 모드 + doctor 경고 + OAuth 2.1 착수.
6. **mcp-setup 통합 테스트 3종** — 모듈 격리 실패, 설치 순서 invariant, 모듈 필터 경계.
7. **Hono 취약점 해소** — `overrides`로 우선 차단 → 근본 의존성 버전 범프.
8. **직접 의존성 5개 정확 고정.**

### P2 (v3.0 준비)
9. **SLO/SLA 대시보드 초기안** — audit 로그 → 로컬 sqlite → `airmcp stats`·`airmcp doctor` 통합.
10. **Swift 브리지 관측성** — `--diagnostics`, 크래시 덤프, 버전 핑.
11. **outputSchema 커버리지 Wave 2** — System/Safari/Shortcuts/Music/Photos 50+ 툴.
12. **Apple 공식 MCP(App Intents) 브릿지 전략** — WWDC 2026 이후 6주 내 포지셔닝 문서화.

---

## 6. 다음 세션 제안 (Claude와 함께 할 수 있는 구체 작업)

질문이 오면 즉시 착수 가능한 단위로 쪼개 두었다.

- **A. TODO.md 재동기화 PR** — CHANGELOG v2.6.4~v2.7.3 delta 기반으로 항목 자동 체크오프 초안. 15분.
- **B. outputSchema Wave 1 PR (Notes)** — 5~6개 툴. 테스트 포함. 1~2시간.
- **C. 에러 카테고리 enum + `toolError` 리팩토링 설계 문서** — 구현 전 합의용 1페이지 RFC. 30분.
- **D. 모듈 manifest에 macOS 매트릭스 도입** — Safari deprecated 툴부터 등록 스킵. 1시간.
- **E. HTTP 배포 가드 `allowNetwork` RFC** — 설정 스키마 + 마이그레이션 경로. 30분.
- **F. CI audit 등급 단계적 상향 계획** — `npm audit --audit-level=moderate` 도입 조건 정리. 15분.

---

## 부록 A. 검증 명령 로그

```bash
# 소스 규모
find src -name "*.ts" | xargs wc -l | tail -1
# => 22988 total

# 테스트 파일/블록
find tests -name "*.test.js" | wc -l              # => 80
grep -rE "^(describe|it|test)\s*\(" tests/ | wc -l # => 1272

# 툴 계약 커버리지
grep -rE "registerTool|server\.tool|addTool" src/ --include="*.ts" | wc -l  # => 278
grep -rE "outputSchema\s*:" src/ --include="*.ts" | wc -l                   # => 29
grep -rE "destructiveHint\s*:\s*true" src/ --include="*.ts" | wc -l         # => 49

# HTTP 가드
grep -nE "AIRMCP_HTTP_TOKEN|bind-all" src/server/http-transport.ts

# Safari deprecated
sed -n '260,278p' src/safari/tools.ts

# Hono 간접 의존
grep -c '"hono"' package-lock.json   # => 2
```

## 부록 B. CHANGELOG 기반 최근 개선 (드리프트 재료)

v2.7.2에서 커버리지를 끌어올린 영역 — 이 항목들은 **TODO.md에서 열린 채로 남아 있음**:

| 모듈 | Before | After |
|---|---|---|
| `src/shared/tool-registry.ts` | 3% | 80% |
| `src/shared/swift.ts` | 10% | 95% |
| `src/shared/hitl-guard.ts` | — | 100% |
| `src/shared/hitl.ts` | — | 100% |
| `src/skills/executor.ts` | 54% | 99% |
| `src/skills/*` | 0% | 99% |

이 표 하나만으로도 TODO.md P1 항목 절반이 체크 가능.

## 부록 C. 참고 파일

- `package.json` (v2.7.3, 직접 의존성 5개)
- `jest.config.js` (커버리지 게이트)
- `.github/workflows/ci.yml` (13단계 blocking)
- `src/shared/jxa.ts` (JXA 안전망)
- `src/shared/hitl-guard.ts` (HITL 분기)
- `src/server/mcp-setup.ts` (441 LOC 동적 로딩)
- `src/server/http-transport.ts` (HTTP + 토큰)
- `src/safari/tools.ts:260-278` (deprecated add_bookmark)
- `TODO.md`, `CHANGELOG.md`, `docs/locales/`

---

*이 문서는 Claude가 레포를 정적 분석해 작성한 진단이며, 런타임·성능·사용자 설문 기반 데이터는 포함하지 않는다. KPI 섹션의 수치 목표(§4)는 초기 기준점일 뿐 팀 합의가 필요하다.*
