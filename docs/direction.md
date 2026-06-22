# AirMCP — Apple 생태계의 컨텍스트 레이어

> **More than Siri. Open to every agent.**
> 갱신일: 2026-06-09 (WWDC 2026 후속 — 태그라인 "Better Siri, powered by open source" → "More than Siri. Open to every agent.", RFC 0011 Q2 판정 + MCP 2층 정정 반영. WWDC가 개발자 층에서 MCP를 "every agent" 인터페이스로 비준 → ethos("Open by design")보다 moat("Open to every agent")를 박음)

**비교 원칙 (브랜드):** AirMCP는 다른 named MCP 서비스/프로젝트(LMCP, apple-mcp, iMCP 등)와 직접 비교하지 않는다 — capability 단독 서술. **단 하나의 의도된 예외 = Siri** (플랫폼 incumbent / 카테고리 앵커). "More than Siri"는 그 예외다. 경쟁 third-party 서버를 도로 끌어들이는 근거로는 쓰지 말 것.

---

## 한 줄 정의

**AirMCP는 Apple 생태계를 AI에 잇는 오픈소스 도구다.**

29개 Apple 앱·프레임워크를 하나의 MCP 인터페이스로 열어, 어떤 AI 클라이언트든 내 Apple 데이터 위에서 읽고·쓰고·행동할 수 있게 한다. "오늘 일정 정리해 줘"가 아니라 **"지난주 회의 메모에서 실행항목 뽑아 리마인더로 옮기고, 완료되면 알려줘"**가 되는 경험 — 그게 이 도구가 여는 지점이다. (AirMCP가 "기억하거나 계획"하는 게 아니라, AirMCP가 노출한 맥락 위에서 AI가 그렇게 할 수 있게 한다.)

---

## 누구를 위한 것인가

- **자기 데이터로 AI에게 일을 시키고 싶은 Apple 사용자.** "오늘 일정 정리해 줘"가 아니라 "지난주 회의 메모에서 실행 항목 뽑아 리마인더로 넣고, 완료되면 알려줘"가 되는 경험.
- **프라이버시가 기본값이어야 하는 사람.** 데이터를 외부에 넘기지 않고, 필요할 때만 opt-in.
- **워크플로우를 직접 설계하고 싶은 사람.** 코드를 쓰지 않고 YAML 한 장으로 자동화.
- **오픈소스에 기여하거나 포크해서 쓰고 싶은 개발자.** TypeScript, 29개 모듈, 확장 1~2파일.

## 무엇이 기본 경험인가

1. **설치가 한 줄.** `npx airmcp init` → Claude Desktop/Code/Cursor/Windsurf가 자동으로 연결된다.
2. **쓰는 만큼 다음 수를 더 잘 추천한다.** 사용 패턴이 축적되면 `proactive_context`와 `suggest_next_tools`가 다음 단계를 제안한다. 학습이 아니라 빈도·순서쌍 기반 추천.
3. **시키는 대로만 움직인다.** destructive 작업은 HITL로 승인을 받고, 모든 호출이 감사 로그에 남는다.
4. **스킬로 굳는다.** 반복하는 흐름은 YAML로 저장해 트리거(시간·이벤트·호출)로 자동 실행.
5. **애플 AI를 그대로 쓴다.** Foundation Models·Vision OCR·NLContextualEmbedding·Speech — 온디바이스 우선.

---

## 브랜드 카피 & 톤

**포지셔닝 (locked, 2026-04-19, README surface는 PR #216으로 reframe 2026-05-12)**

- **우선 타깃:** 파워 애플 유저 (프로슈머) — 이미 Apple에 데이터를 다 넣어놓은 사람
- **정체성:** Apple 생태계를 AI에 잇는 도구 (= Apple 생태계의 컨텍스트 레이어 / agent runtime 레이어)
- **핵심 태그라인 (랜딩):** `More than Siri. Open to every agent.`
- **핵심 태그라인 (README):** `Apple-native agent runtime for any MCP client.` (PR #216, WWDC 6/8 overhang 대응)
- **톤의 성격:** 도구는 도구로 말한다. "AI가 나를 안다"는 인격화는 사용 안 함 — AirMCP는 **노출하고**, 아는 건 AI의 몫.

**Hero 카피 (랜딩, 프로슈머 대면)**

```
More than Siri. Open to every agent.
지난주 회의 메모에서 실행항목을 뽑아 리마인더로 옮기고,
완료되면 알려줍니다.
```

영문:

```
More than Siri. Open to every agent.
Pull action items from last week's meeting notes,
drop them into Reminders, get pinged when they're done.
```

한 문장에서 Siri의 세 가지 결함 — 기억 없음, 크로스앱 모름, 수동·단편 — 을 동시에 공격한다. 비교 없이도 Siri와의 격차가 즉시 체감되는 use-case.

**Hero 카피 (README, 개발자 대면 — PR #216)**

```
Apple-native agent runtime for any MCP client.
Skills DSL workflow engine, semantic memory, OAuth 2.1, HMAC-chained audit log
— over native Swift bridges into EventKit, HealthKit, PhotoKit, Vision, and Foundation Models.
```

WWDC 6/8 overhang 대응: "Apple-native MCP server"가 아닌 **runtime layer**로 reframe해 Apple system MCP API와 직접 충돌 회피. Apple's tools = bottom layer, AirMCP = middle layer (workflow + memory + safety).

**3-surface 톤 모델 (표면마다 다른 목소리)**

| Surface | 톤 | 누구에게 | 카피 예시 |
|---------|----|----|----------|
| 랜딩·소개 (`docs/index.html`) | 프로슈머 메이커 + 애플 미니멀 | Siri에 매일 실망하는 파워 유저 | "More than Siri. Open to every agent." + 행동체인 use-case |
| GitHub README·개발자 문서 (`docs/site/`) | 건조·정확·런타임 레이어 강조 | MCP 서버를 포크·확장할 개발자 | "Apple-native agent runtime for any MCP client. 286 tools / 29 modules + Skills DSL + semantic memory + OAuth 2.1 + HMAC audit log." (PR #216 hero) |
| Skills 가이드·블로그·릴리즈 노트 | 오픈소스 커뮤널 (투명성) | 공통 | 실사용 예시, 로드맵 공개, 기여 초대 |

한 문서가 두 청중을 동시에 설득하려 하지 않는다. 랜딩은 감정, docs는 스펙·레이어, 블로그는 투명성 — 각 표면이 자기 일만 한다.

---

## 현재 상태 (2026-05-12, v2.12.0)

| 지표 | 값 |
|------|-----|
| 모듈 | 29 (notes, reminders, calendar, contacts, mail, messages, music, finder, safari, system, photos, shortcuts, intelligence, tv, ui, screen, maps, podcasts¹, weather, pages, numbers, keynote, location, bluetooth, google, speech, health, memory, audit) |
| 툴 | 272 (정적, count-stats canonical) + Shortcuts 동적 등록 |
| 프롬프트 | 32 (한국어 워크플로우 18+ 포함) |
| 리소스 | 9 |
| 빌트인 Skills | 14 (YAML DSL, parallel/loop/조건/이벤트 트리거, on_error 지원) |
| AppIntents | 232 (RFC 0007 Phase A 229 + RFC 0009 batch 1 3) |
| AppEnum | 17 자동 생성 |
| Apple 네이티브 통합 | EventKit, Contacts, HealthKit, NLContextualEmbedding, Foundation Models, Vision OCR, Core Spotlight, ImagePlayground, Speech |
| On-device AI | 요약·재작성·교정·구조화 출력·분류·대화·이미지 생성·문서 OCR·계획 생성·자율 에이전트 |
| 보안·관측 | HITL 듀얼채널, 감사 로그 JSONL + HMAC chain + correlation id, OpenTelemetry, 프로토타입 오염 방어, circuit breaker, RFC 0001 error 카테고리 (PERMISSION/INVALID_INPUT/NOT_FOUND/UPSTREAM/SWIFT/DEPRECATED), rate limit + emergency-stop kill switch |
| Transport | stdio, HTTP(+bearer), OAuth 2.1 + PKCE + Resource Indicators (RFC 0005 Step 1+2 ✅) + SEP-985/RFC 9728 정합 |
| 디스커버리 | `.well-known/mcp.json` 세션리스 + `tools/modules/license/homepage/schema_version` 필드 |
| 패키징 | npm (`airmcp`), `.mcpb` Desktop Extensions 번들 |
| 자동 등록 | Claude Desktop, Claude Code, Cursor, Windsurf |
| 테스트 | 107 파일 / ~1,755 케이스 / 커버리지 ≥46% 게이트 |

¹ podcasts 모듈은 macOS 26+에서 `brokenOn: [26]` 게이트로 등록 스킵 (Apple이 Podcasts JXA 딕셔너리 제거). v3.0.0에서 드랍 예정.

---

## 사명 (Mission)

1. **Apple 사용자가 자기 맥락으로 AI에게 일을 시킬 수 있게 한다.** 흩어져 있는 데이터를 하나의 인터페이스로.
2. **AI가 맥락을 쌓고 계획할 수 있는 재료를 제공한다.** Semantic 색인·Skills·이벤트 버스는 AI의 기억·계획을 가능하게 하는 *스캐폴드*다. AirMCP 자신이 기억하거나 계획하지 않는다.
3. **1인 개발자도 유지·확장할 수 있게 만든다.** 모듈 추가 1줄, 스킬 1 YAML, 자동 호환성 해석.

---

## 원칙 (제품 결정이 흔들릴 때 돌아올 기준)

1. **로컬이 기본값, 클라우드는 opt-in.** 기본 설정으로 사용자 데이터가 외부로 나가지 않는다.
2. **단순성 > 완전성.** 툴 하나가 20개 파라미터를 받는 것보다 3개씩 7개 툴이 낫다.
3. **사용자 승인이 디폴트.** destructive 툴은 항상 승인 절차를 거칠 수 있어야 한다.
4. **오픈소스로 유지.** 수익화는 목표 아님. 신뢰와 생태계가 자산.
5. **1인이 유지 가능한 복잡도.** 모듈 추가/스킬 추가가 1~2파일로 끝나는 구조를 유지한다.

---

## 하지 않는 것 (Non-goals)

포커스를 위해 의도적으로 하지 않는 영역.

- **Android / Windows 지원** — Apple 생태계 전용
- **서버 중심 웹 SaaS화** — 로컬-first 원칙, managed hosting은 당분간 없음
- **자체 AI 모델 개발** — Foundation Models 및 사용자가 선택한 외부 API만 사용, 모델 학습 안 함
- **Electron/Tauri 별도 데스크톱 앱** — MCP 서버 + 경량 메뉴바 앱 조합 유지
- **특정 호스트 전용 최적화** — Claude 경험에 맞추되 다른 MCP 호스트 호환성을 깨지 않음

---

## 로드맵 (v2.12 → v3.0)

세부 권고 근거는 [`docs/archive/2026-04-19-advancement-recommendations.md`](archive/2026-04-19-advancement-recommendations.md) 참조 (역사 자료, Phase A/B 4/4 출하 완료, Phase C 1/4+1 진행 중). 아래는 *현재 시점에서 열린 항목만*.

### ✅ 이미 출하 (v0.3 → v2.12 사이에 닫힌 것)

- Skills 쇼케이스 빌트인 14종 (계획 7 → 실제 14)
- `audit_log` / `audit_summary` 툴 + HMAC chain (v2.12 PR #192) + correlation id (v2.12 PR #190 / #198)
- Rate limit + `emergency-stop` 킬 스위치 (`src/shared/rate-limit.ts`)
- 맥락 기억 색인 (Context Memory Index) — `memory` 모듈 4툴 + 9 리소스 중 일부
- Skills `on_error` — executor + 빌트인 yaml 6개에서 사용
- 이벤트 타입 확장 — 3 → 9개 (mail_unread, focus_mode, now_playing, file_modified, screen_locked, screen_unlocked 추가)
- HITL Phase 1 (elicitation + capability 게이트) = RFC 0008 Phase 1 (v2.12 PR #196)
- OAuth 2.1 + PKCE + Resource Indicators (RFC 0005 Step 1+2) + SEP-985 / RFC 9728 정합 (v2.12 PR #193)
- `.mcpb` Desktop Extensions 패키징
- RFC 0007 Phase A (229 AppIntents 자동 생성)
- RFC 0009 Phase 1 batch 1 (3 numbers 도구, 14 queued)
- RFC 0012 Phase 1 prep — cron parser + scheduler state + hitl queue (v2.12 PR #207)
- iOS companion 골격 1954 LOC (`ios/Sources/AirMCPServer` + `AirMCPiOS`)
- `npx airmcp doctor --deep` 진단 (v2.12 PR #198)
- README runtime layer reframe (v2.12 PR #216, WWDC 6/8 overhang 대응)
- outputSchema Wave 1-7 출하 (24% coverage, system 19 + music 14 + shortcuts 8 = 41 untyped 잔여)

### v2.13~v2.15 — WWDC 6/8 직전~직후 (5/12 → 7/15)

- **RFC 0011 §5 quadrant 선택 + execute** — 6/8 키노트 후 30분 안에. 48h 윈도. 시나리오 매트릭스는 `docs/rfc/0011-post-wwdc-2026.md` §5 (uncommitted draft +111 line).
- **mcp-setup.ts 통합 테스트 3종** (WWDC 전 반드시) — `tests/mcp-setup.test.js` 작성 중 (untracked, QUALITY_DIAGNOSIS MEDIUM-1)
- **RFC 0012 daemon mode Phase 2** — Phase 1 prep 완료. 다음: event loop 배선 + hitl queue 활성화 + launchd plist 자동 설치
- **RFC 0009 Phase 1 batch 2/3** — `scripts/smoke/numbers-rfc0009-batch{2,3}.mjs` 작성됨 (untracked), 14 queued tools 본 구현
- **outputSchema Wave 8 focused** — system 19 + music 14 + shortcuts 8 untyped 중 read/idempotent만 추려 ~15-20
- **macOS 26.5 GA (5/15±1주) 호환성 매트릭스 검증** — CI runner 추가
- **iWork 신규 모듈 또는 깊이 확장** — 6/8 발표 의존
- **`gitleaks/gitleaks-action` Node.js 24 대응** (2026-06-02 강제 전환, 3주 마감)

### v3.0 — 메이저 정리 (post-WWDC, 6/15+)

- Safari `add_bookmark` 레거시 ≤25 등록 코드 제거 (deprecation removeAt: 3.0.0)
- podcasts 모듈 코드 제거 또는 Shortcuts 브리지로 재구현 (removeAt: 3.0.0)
- RFC 0011 §5에서 선택된 quadrant의 후속 architecture 변경

### 백로그 (시점 미정 — 6/8 결과 의존)

- **C5 음성 엔드투엔드** (`start_listening` 핫워드 + `speak_text`) — *"진짜 Siri 대체"* 증명
- **MCP Apps 확장** — Photo Memory / Health Dashboard / Workflow Result
- **HomeKit Phase 0** (6/8에 Apple system MCP 발표 시 *재평가*)
- **Translate / Voice Memos / Books / Stocks** 신규 모듈
- **HITL batch + trust-learning + dry-run**
- **CloudKit private DB 벡터 싱크**
- **iOS companion MVP 출하** (Reminders + Calendar)
- Anthropic 공식 MCP Registry 정식 등재

---

## 관련 문서

- [`docs/archive/2026-04-19-advancement-recommendations.md`](archive/2026-04-19-advancement-recommendations.md) — 본 방향성 작성 시 참조한 고도화 권고 (Phase A/B 4/4 출하 완료, Phase C 1/4 + 1 진행).
- [`QUALITY_DIAGNOSIS_2026-04-17.md`](../QUALITY_DIAGNOSIS_2026-04-17.md) — 진행 progress tracker (§0 갱신 5/12 기준 HIGH 4/4 + MEDIUM 4/5 해결).
- [`docs/rfc/0011-post-wwdc-2026.md`](rfc/0011-post-wwdc-2026.md) — WWDC 시나리오 매트릭스 (uncommitted +111 line draft).
- [`TODO.md`](../TODO.md) — 현재 P0/P1/P2/P3 작업 목록 (v2.12.0 동기화 완료).
