> ## 📦 ARCHIVED 2026-05-12
>
> 본 문서는 **2026-04-19** 작성된 v2.7-ish 코드 기반 권고서입니다. 이후 8 minor 릴리스 (v2.8 ~ v2.12) 동안 권고 항목 대부분이 출하 완료됐습니다.
>
> **현재 활성 strategy 문서**: [`docs/direction.md`](../direction.md)
>
> **Phase 진행 상황 (2026-05-12 기준)**
>
> | Phase | 권고 | 상태 |
> |-------|------|------|
> | **A (1-2주, 즉시 효과)** | B1 / B3 / B6 / C10 | **4/4 출하** (v2.8 ~ v2.10) |
> | **B (3-6주, 차별화 강화)** | B2 / B4 / C1 / C7 | **4/4 출하** (v2.9 ~ v2.11) |
> | **C (2-3달, 생태계 확장)** | B5 / C2 / C3 / C6 | **1/4 출하 + 1 진행 중** (C2 = RFC 0012 Phase 1 prep PR #207, C6 3/4 MCP Apps 출하) |
> | **D (6달+, 비전)** | C4 / C5 | **1/2 부분** (C4 iOS 1954 LOC base, C5 미진행) |
>
> **아직 열린 권고**:
> - **B5** HITL batch / trust-learning / dry-run (TODO P3)
> - **C3** CloudKit private DB 벡터 싱크 (TODO P3)
> - **C5** 음성 엔드투엔드 — `start_listening` + `speak_text` (TODO P3, *"진짜 Siri 대체"* 증명 단일 PR)
> - **C6** 4번째 MCP App (Photo Memory / Health Dashboard / Workflow Result 중 1)
>
> 본 문서는 **역사 자료로 보존** — 2026-04-19 시점에 본 큰 그림이 v2.12까지 정확히 실현됐다는 기록.
> 본 문서가 명시한 "v0.3 → v1.0 로드맵" 표현은 당시 버전 카운팅 기준이며, 현재 실제 버전은 v2.12.

---

# AirMCP 고도화 사항 추천 (코드 기반 재작성)

> 작성일: 2026-04-19
> 기반: `src/` 전체 코드 리뷰 (27 모듈, shared 인프라, skills 엔진, Swift 브리지, Foundation Models 통합)

---

## 서문 — 앞 답변에 대한 정정

이전에 드린 "고도화 추천" 중 상당수는 이미 구현된 기능이었습니다. 실제 `src/` 전체를 읽어 보니 AirMCP는 **27개 모듈 + 250개 이상의 툴 + 성숙한 crosscutting 인프라**(HITL, 감사 로그, 텔레메트리, Skills DSL, 이벤트 버스, Foundation Models 통합, MCP Sampling 등)를 이미 갖춘 상태였습니다. 따라서 이번 문서는 세 단계로 정리했습니다.

1. **[A] 이미 구현되어 있어 권고 대상에서 제외되는 것** — 실수했던 부분
2. **[B] 구현은 있으나 완성도가 낮아 고도화 여지가 있는 것**
3. **[C] 실제로 빠져 있어 새로 권고하는 것**

---

## [A] 이미 구현되어 있어 추천하지 않는 것

과거 답변에서 "추가하면 좋다"고 말씀드렸지만 실제로는 이미 있거나 동등한 수준으로 구현된 기능들입니다.

| 주제 | 실제 구현 위치 |
|------|---------------|
| MCP Resources (notes/calendar/reminders/context snapshot) | `src/shared/resources.ts` — depth(brief/standard/full) 까지 지원, TTL 캐시 |
| Skills YAML DSL (조건/병렬/루프/이벤트 트리거) | `src/skills/types.ts`, `src/skills/executor.ts` — `only_if`/`skip_if`, `parallel`, `loop`, `{{stepId.field}}` 템플릿 포함 |
| 이벤트 트리거 (calendar/reminders/pasteboard 변화 시 자동 실행) | `src/shared/event-bus.ts`, `src/skills/triggers.ts` — debounce, 재시도 1회 |
| Multi-backend Swift/JXA fallback | `src/shared/automation.ts`의 `runAutomation()` |
| Spotlight 싱크 (Siri가 노트/일정 검색) | `src/semantic/tools.ts` `spotlight_sync`, `spotlight_clear` |
| Apple Foundation Models 전체 스위트 | `src/intelligence/tools.ts` — `summarize_text`, `rewrite_text`, `proofread_text`, `generate_structured`, `tag_content`, `ai_chat`, `generate_image`, `scan_document`, `generate_plan`, `ai_agent` |
| MCP Sampling (클라이언트 LLM 위임) | `src/cross/tools.ts` `summarize_context` — Sampling → Foundation Models → raw fallback 체인 |
| 프롬프트 레시피 카탈로그 | `src/cross/prompts.ts` — 한국어 워크플로우 18종 (`meeting-notes-to-reminders`, `weekly-digest`, `daily-briefing`, `focus-session`, `travel-planner`, `inbox-zero` 등) |
| 사용 패턴 기반 툴 추천 | `src/shared/usage-tracker.ts` + `suggest_next_tools` 툴 |
| 시간대별 proactive 컨텍스트 | `src/shared/proactive.ts` + `proactive_context` 툴 (weekend 로직 포함) |
| RFC 0004 호환성 해석기 | `src/shared/compatibility.ts` `resolveModuleCompatibility()` — minMacosVersion/brokenOn/requiresHardware/deprecation 전부 |
| HITL 듀얼 채널 (MCP Elicitation + Unix socket) | `src/shared/hitl-guard.ts`, `src/shared/hitl.ts` — Claude 제품 자동 스킵, whitelist, destructive-only/all-writes 레벨 |
| Shared 데이터 접근 가드 | `src/shared/share-guard.ts` — filterSharedAccess + guardSharedAccess |
| 감사 로그 (PII 리덕션, 회전, 0600) | `src/shared/audit.ts` — SENSITIVE_TOOL_PATTERNS, 30초 버퍼, MAX_FILE_SIZE 회전 |
| OpenTelemetry 텔레메트리 | `src/shared/telemetry.ts` — dynamic import, traceApproval, traceToolCall |
| Circuit breaker + 세마포어 동시성 제어 | `src/shared/jxa.ts` — LRU 캐시, 오픈/하프오픈 전이 |
| 프로토타입 오염 방어 | `src/shared/swift.ts` `safeParseBridgeResponse` |
| iCloud 사용 데이터 싱크 | `cloud_sync_status` 툴 (Swift 브리지) |
| 자동 MCP 클라이언트 등록 | `src/shared/setup.ts` 체인 — Claude Desktop/Code/Cursor/Windsurf |
| MCP Apps (인터랙티브 UI) | `src/apps/tools.ts` — Calendar week view, Music player |
| HTTP transport + bearer token | `src/server/http-transport.ts` |
| Google Workspace 통합 (Gmail/Drive/Sheets/Docs/Tasks/People) | `src/google/tools.ts` — 11개 서비스, destructive 가드 |
| HealthKit, Accessibility UI 자동화 (AX query/traverse/diff) | `src/health/`, `src/ui/tools.ts` |
| `get_workflow` (자율 에이전트용 프롬프트 노출) | `src/server/mcp-setup.ts` |

**결론:** 단순한 Apple CRUD 래퍼 단계는 이미 지나 있고, **기억·계획·자동화·관측이 함께 쌓인 상위 레이어**가 코드에 자리잡혀 있습니다. 고도화 논의는 이 층을 어떻게 더 두텁고 신뢰할 수 있게 만드느냐에 집중합니다.

---

## [B] 구현은 있으나 완성도를 높일 여지가 있는 것

이 영역이 가장 투자 대비 효과가 큽니다. "0→1"이 아니라 "70→95"라서 기존 구조를 깨지 않고 확장할 수 있습니다.

### B1. Skills DSL — 실전 빌트인이 부족함

**현재 상태:** `src/skills/builtins/`에 빌트인 스킬이 4개(morning-briefing, meeting-action-items, inbox-triage, calendar-alert)뿐이고, 대부분은 단순 linear 호출입니다. DSL은 `parallel`, `loop`, `only_if`, 이벤트 트리거를 모두 지원하는데 정작 이를 활용하는 예시가 없어서 외부 사용자가 DSL의 잠재력을 체감하기 어렵습니다.

**권고:**
- 실제로 `parallel` + `loop` + 조건 분기를 섞은 "쇼케이스 스킬" 5~7개 추가:
  - `weekly-review-builder` — 지난주 일정/할일/읽지 않은 메일을 parallel로 수집 → loop로 각 회의 요약 → Notes에 draft
  - `focus-block-planner` — 오늘 빈 시간을 찾아 각 할일 시간 블로킹 (calendar 생성 루프)
  - `clipboard-triage` — pasteboard_changed 트리거, URL 감지 시 Safari reading list 추가, 주소면 Maps 검색
  - `photo-memory-digest` — 1년 전 오늘 사진 가져와 Notes 일기 생성
  - `email-to-task` — 특정 발신인의 읽지 않은 메일을 loop로 돌려 자동 리마인더 생성
- 스킬마다 `trigger`(시간대·이벤트) + `only_if`(조건) + `expose_as: prompt`(가이드로도 사용) 중 두 가지 이상 조합

### B2. `generate_plan` / `ai_agent` — 평가·관측 체계 부재

**현재 상태:** `intelligence/tools.ts`에 on-device 플래너와 에이전트가 있지만, 생성된 계획의 품질을 측정할 테스트 스위트나 실패 케이스 로깅이 없음. Foundation Models 출력은 비결정적이라 회귀가 쉽게 발생합니다.

**권고:**
- `tests/ai-plans/*.json` — 입력 프롬프트 + 기대 툴 셋 (부분 집합 매칭) 고정 케이스 20~30개
- 생성된 plan을 audit 로그에 별도 카테고리(`ai.plan`)로 남기고, 실제 실행 결과와 대조해서 **플래너 정확도 메트릭** (툴 이름 적중률, 단계 수 분포) 계산
- `ai_agent` 실행 시 각 step 실패 원인(permission? tool not found? timeout?) 분류·집계 → `ai_agent_metrics` 툴로 노출

### B3. 툴 description 품질 — discover_tools의 정확도에 직결

**현재 상태:** `discover_tools`는 substring → semantic fallback으로 우수하지만, 툴 description이 "List notes" 같이 짧은 것이 많습니다. semantic 임베딩이 영어 짧은 텍스트만 보고 판단하므로 한국어 쿼리 적중률이 떨어질 수 있습니다.

**권고:**
- 각 툴의 description 2줄로 확장 (무엇을 하는지 + 언제 쓰는지 + "관련 개념" 키워드)
- 한국어 alias 필드 추가 (registry 내부에만 저장, wire에는 compact 유지) → 한국어 검색 성능 대폭 향상
- `discover_tools`에 `locale` 파라미터 추가

### B4. Event bus — 구독 가능한 이벤트 종류가 3개뿐

**현재 상태:** calendar_changed, reminders_changed, pasteboard_changed만 Swift observer에서 구독. 하지만 Apple 생태계에서 유용한 이벤트는 훨씬 많습니다.

**권고 (우선순위 순):**
1. `mail_unread_changed` — 새 메일 도착 (NSWorkspace/Mail.app 옵저버)
2. `focus_mode_changed` — DND/Work/Personal 전환 (NSWorkspace notification)
3. `now_playing_changed` — 음악 곡 변경
4. `network_changed` — WiFi 변경 (위치 기반 스킬 트리거용)
5. `file_added` / `file_modified` — Finder 특정 폴더 (Downloads 자동 정리 스킬용)
6. `screen_locked` / `screen_unlocked` — 퇴근 자동화용

각각 Skills DSL의 trigger로 연결되면 "퇴근하면 focus mode 풀고 음악 재생" 같은 자동화가 가능해집니다.

### B5. HITL — 배치 승인과 학습 기능 부재

**현재 상태:** 도구별 개별 승인만 지원. 하나의 스킬이 30개 도구를 호출하면 30번 묻게 됩니다 (스킬의 destructive 단계만 묻더라도 여전히 번거로움).

**권고:**
- **Batch approval**: skill 실행 시 "이 스킬은 create_note × 10, update_note × 3를 호출합니다. 일괄 승인하시겠습니까?" 한 번으로 종결
- **Trust learning**: 같은 발신(tool × args 패턴)을 3회 승인하면 "앞으로 묻지 않음" 옵션 제시. `~/.config/airmcp/hitl-trusted.json` 저장
- **Dry-run**: 스킬에 `--dry-run` 지원, 모든 destructive를 no-op으로 돌려 영향 범위를 먼저 리포트

### B6. 감사 로그 — 소비 경로 없음

**현재 상태:** JSONL로 잘 쌓이지만, 정작 사용자는 "지난주에 AirMCP가 뭐 했지?"를 조회할 수단이 없습니다.

**권고:**
- `audit_log` 툴 추가 — 날짜 범위/툴 이름 필터로 로그 조회
- `audit_summary` 툴 — 주/월 단위 통계 (가장 많이 호출된 툴 Top 10, 총 destructive 횟수, 실패율)
- MCP Resource `audit://recent` 노출 — 클라이언트가 주기적으로 폴링 가능

### B7. Semantic search — Notes/Calendar에만 국한

**현재 상태:** `semantic/service.ts`가 Notes, Calendar, Reminders, Mail, Photos albums, Finder Documents/Desktop/Downloads 일부까지는 색인하지만 Safari 북마크, Podcasts, Shortcuts, Contacts 노트 필드는 제외.

**권고:**
- Safari 북마크/reading list → "AirMCP에 대한 기사 어디서 읽었지?" 류 쿼리에 강력
- Shortcuts description/metadata → 사용자가 만든 단축어를 자연어로 찾기
- Contacts notes 필드 → CRM 라이트한 사용
- Mail 본문은 현재 제외되어 있는 것으로 보임 (용량 이슈) → opt-in으로 켤 수 있는 플래그 추가

### B8. Tool output — structured output 적용 범위 불균일

**현재 상태:** 일부 툴만 `outputSchema`를 선언 (예: `list_notes`, `health_summary`, `discover_tools`). 나머지는 free-form JSON. Claude 같은 호스트가 UI 렌더링하기 어렵습니다.

**권고:**
- 전체 툴을 한 바퀴 훑어 outputSchema 정의 (최소한 read 계열은 전부). 이미 있는 `autoSizeHint`와 조합하면 대형 응답의 자동 분할 UX가 좋아집니다.
- 대형 결과에는 `_meta.uiHint: "table" | "list" | "summary"` 추가해서 MCP Apps로 확장 가능하도록

---

## [C] 실제로 빠져 있어 새로 권고하는 것

AirMCP의 서비스 목적("Apple 생태계 × AI × 오픈소스 표준, Siri가 못한 것을 대체")에 직접적으로 기여하면서 현재 **구현이 없는** 항목만 모았습니다.

### C1. 맥락 기억 색인 (Context Memory Index) — 가장 큰 차별화 기회

**왜 중요한가:** 현재 AirMCP는 호출 단위 CRUD만 지원 — AI 클라이언트는 매 요청마다 맥락을 재구축해야 합니다. AI가 질의할 수 있는 **기억 스토리지**를 도구 측에 두면, AI는 "지난달에 내가 이 프로젝트에 대해 남긴 말"을 빠르게 소환할 수 있게 됩니다. AirMCP 자신이 기억하는 게 아니라 AI가 질의하는 **색인**입니다.

**제안 구조:**
```
~/.config/airmcp/memory/
├── facts.jsonl          ← 사용자 선호·규칙·사실
├── entities.jsonl       ← 사람·프로젝트·장소 정의
└── episodes.jsonl       ← 최근 상호작용 요약 (자동 롤링)
```

- `memory_add({kind, key, value, ttl?})` — 명시적으로 저장
- `memory_recall({query})` — 임베딩 기반 회상 (기존 semantic/store 재사용)
- **자동 추출**: `generate_plan` 실행 후 사용자가 승인한 패턴을 자동으로 episodes에 요약 저장
- MCP Resource `memory://recent` 노출
- HITL "이 정보를 기억할까요?" 엘리시테이션 훅

### C2. Background scheduler (cron-like) — 스킬의 자동 실행 시점 확장

**현재 상태:** Skills는 이벤트 트리거 혹은 수동 호출만 가능. 시간 기반 트리거 없음.

**Cowork의 `mcp__scheduled-tasks__create_scheduled_task`가 있지만 AirMCP 내부 스킬이 스케줄링되는 것은 아님.**

**권고:**
- 스킬 DSL에 `trigger: { cron: "0 8 * * 1-5" }` 지원
- macOS launchd plist를 자동 생성·설치하는 `airmcp schedule <skill>` CLI
- 또는 AirMCPApp (Swift 메뉴바 앱)이 내부 스케줄러 운용 (이미 persistent 프로세스니 자연스러움)

### C3. 다중 디바이스 벡터 싱크 — "애플 생태계" 슬로건 실현

**현재 상태:** 사용 데이터(usage-tracker JSON)는 iCloud 싱크되지만, **의미 검색용 임베딩 벡터는 기기 로컬**에 있음. 두 번째 Mac/iPad/iPhone 에서 iMessage로 접근하면 완전히 새 인덱스를 빌드해야 함.

**권고:**
- 벡터 DB를 CloudKit private database로 업로드 (Swift 브리지에서 처리, TCC 필요 없음)
- 새 기기에서 초기화 시 기존 인덱스 즉시 복원
- 충돌 해결: CRDT last-writer-wins, 기기별 namespace

### C4. iOS/iPadOS 위성 컴패니언 — 로드맵 Phase 3 실체화

**현재 상태:** 방향성 문서에 "장기 비전"으로 언급되어 있지만 코드 없음. macOS 전용.

**권고:**
- 동일 Swift 브리지 소스에서 iOS 타깃 추가 (EventKit, HealthKit, Reminders는 iOS에서도 대부분 동작)
- iOS에서는 stdio 대신 WebSocket으로 연결, macOS 서버가 릴레이
- MVP: Reminders/Calendar만. Mail/Notes는 iOS 쪽 보안 제약이 커서 Phase 2

### C5. "Claude에게 Siri처럼 말하기" — Voice in/out 엔드투엔드

**현재 상태:** `transcribe_audio`로 STT는 되지만 **마이크 실시간 입력 → 자동 전사 → Claude에 전송**하는 경로가 없고, TTS도 없음.

**권고:**
- `start_listening({trigger?: "hotword", max_duration: 30})` — 핫워드("Hey AirMCP")까지 대기 → 이후 N초 녹음 → 자동 transcribe → 클라이언트에 MCP progress notification으로 전송
- `speak_text({text, voice?: "Samantha"})` — AVSpeechSynthesizer 래핑
- 핫워드 감지는 Apple Speech framework의 `SFSpeechRecognizer + contextualStrings`
- 이게 되면 "진짜 Siri 대체"라는 포지셔닝이 한 줄 증명됨

### C6. Rich result types — UI 결과물이 부족

**현재 상태:** MCP Apps는 Calendar week, Music player 두 개뿐. 다른 응답은 전부 텍스트/JSON.

**권고 (MCP Apps 확장):**
- **Timeline view** — 하루/주/월 일정 + 할일을 시간축에 합친 뷰
- **Photo memory card** — `photo-memory-digest` 출력용
- **Health dashboard** — health_summary의 대시보드 (링 차트 3개)
- **Workflow result** — 스킬 실행 결과의 단계별 상태 + 각 단계 링크
- 각각 `ui://airmcp/<name>` 리소스로 등록, 동일한 CSP 패턴 재사용

### C7. 에러 회복 — skills 실패 시 부분 결과 보존

**현재 상태:** 스킬 executor는 step 실패 시 전체 중단. 앞 step의 결과는 버려짐.

**권고:**
- step에 `on_error: "continue" | "halt" | "retry:3"` 추가
- 실패해도 이후 step이 `{{stepId.error}}`로 접근 가능
- 최종 결과에 `partial: true, failed_steps: [...]` 포함
- 이것만 추가하면 "10개 메모를 처리" 같은 루프 스킬이 훨씬 견고해짐

### C8. 권한 재인증 UX — TCC 회수 시 자동 복구 동선

**현재 상태:** `setup_permissions` 툴은 있지만 **중간에 권한이 회수된 경우** 명확한 동선이 없음. JXA 에러 코드 -1743이 나오면 스크러빙된 메시지만 표시.

**권고:**
- 툴 핸들러에서 -1743 계열 에러를 잡아 **자동으로 `setup_permissions` 실행 제안**을 응답에 포함
- 혹은 AirMCPApp이 감지 시 macOS 알림 + "Fix permissions" 버튼
- `doctor` 서브커맨드가 권한 상태를 자동 검사 → TCC 다이얼로그 직행

### C9. AppleScript/JXA 회귀 검출 — macOS 업데이트 리스크 관리

**현재 상태:** macOS 26.1 같은 minor 업데이트가 AppleScript 동작을 깨는 일이 잦음. 현재 회귀 여부를 선제적으로 알 방법이 없음.

**권고:**
- `tests/smoke/*.spec.ts` — 각 모듈의 대표 read 작업 1개씩 실행해서 non-zero exit이면 실패
- macOS 버전별 결과를 `compatibility-matrix.json`에 기록
- `airmcp doctor`가 이걸 읽어서 "macOS 26.1.1에서 검증됨" 배너 표시
- CI는 어렵지만 (macOS self-hosted runner 필요) 로컬에서 `npm run smoke` 한 줄이면 충분

### C10. Rate limiting + kill switch — 에이전트 폭주 방지

**현재 상태:** `ai_agent`가 자율적으로 툴을 호출하는데 상한이 없음. 버그 시 Notes 100개 생성 가능성 존재.

**권고:**
- Config에 `maxToolCallsPerMinute`, `maxDestructivePerHour` (기본값 60, 10)
- 초과 시 다음 호출을 즉시 block + audit 기록
- `~/.config/airmcp/emergency-stop` 파일이 존재하면 모든 destructive 툴 즉시 거부 (사용자의 kill switch)

---

## 우선순위 로드맵 권고

"구현 비용 × AirMCP 목적 기여" 기준:

### Phase A (1~2주, 즉시 효과)
- B1: 쇼케이스 스킬 5~7개 (DSL 실사용 예시) — README에서 바로 시연 가능해짐
- B3: 툴 description 한국어 alias — discover_tools 체감 성능 크게 개선
- B6: audit_log / audit_summary 툴 — 신뢰성의 증거를 사용자에게 노출
- C10: rate limit + kill switch — AI agent 기능의 안전 장치

### Phase B (3~6주, 차별화 강화)
- B2: `generate_plan`/`ai_agent` 테스트 스위트 + 메트릭
- B4: 이벤트 타입 3→8개 확장 (mail_unread_changed, focus_mode_changed 우선)
- C1: 맥락 기억 색인 (facts/entities/episodes)
- C7: skills on_error / 부분 결과 보존

### Phase C (2~3개월, 생태계 확장)
- B5: HITL batch/trust learning/dry-run
- C2: background scheduler (launchd 통합)
- C3: 다중 디바이스 벡터 싱크
- C6: rich UI MCP Apps 추가 4종

### Phase D (6개월+, 비전)
- C4: iOS 컴패니언
- C5: 음성 엔드투엔드 ("진짜 Siri 대체" 증명)

---

## 현행 방향성과의 정합

본 권고는 `airmcp-direction.md`를 전제로 한다.

- **AirMCP는 Apple 사용자의 일상 데이터를 AI가 이해·작동시킬 수 있는 형태로 노출하는 컨텍스트 레이어.** 27개 모듈을 기억·계획·자동화 레이어로 묶는다.
- 평가 기준은 **"1인 개발자가 유지 가능한 복잡도 안에서, 사용자가 자기 맥락으로 AI를 부릴 수 있는 경험을 얼마나 두텁게 쌓느냐"** 로 단일화한다.
- 본 문서의 Phase A~D는 `airmcp-direction.md`의 v0.3 → v1.0 로드맵과 일대일 대응.
