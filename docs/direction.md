# AirMCP — Apple 생태계의 통제형 MCP 런타임

> **Governed MCP runtime for the Apple ecosystem.**
> 갱신일: 2026-07-24 (macOS는 현재 제공 플랫폼으로 유지하되 제품 정체성은 Apple 생태계 전체의 통제형 런타임으로 확정.)

**비교 원칙 (브랜드):** AirMCP는 다른 named MCP 서비스/프로젝트(LMCP, apple-mcp, iMCP 등)와 직접 비교하지 않는다. capability를 단독 서술한다. "More than Siri"는 캠페인·비교 섹션에서만 쓸 수 있으며 README·랜딩 히어로·SEO·레지스트리의 정체성 문구로 쓰지 않는다.

---

## 한 줄 정의

**AirMCP는 Apple 생태계를 위한 통제형 MCP 런타임이자, AI 클라이언트와 Apple 앱 사이의 연결·제어 계층이다.**

Notes, Mail, Calendar, Reminders, Shortcuts 등 Apple 작업 공간을 하나의 MCP 인터페이스로 열어, 어떤 MCP 클라이언트든 프로필·점진적 검색·호출별 승인·HMAC 감사 체인 아래에서 읽고·쓰고·행동할 수 있게 한다. macOS 런타임은 현재 제공 중이고 iOS 런타임은 프리뷰다. visionOS와 watchOS는 같은 통제 계층을 각 플랫폼의 역할에 맞게 확장하는 로드맵 대상이다.

---

## 누구를 위한 것인가

- **자기 데이터로 AI에게 일을 시키고 싶은 Apple 사용자.** "오늘 일정 정리해 줘"가 아니라 "지난주 회의 메모에서 실행 항목 뽑아 리마인더로 넣고, 완료되면 알려줘"가 되는 경험.
- **프라이버시가 기본값이어야 하는 사람.** 데이터를 외부에 넘기지 않고, 필요할 때만 opt-in.
- **워크플로우를 직접 설계하고 싶은 사람.** 코드를 쓰지 않고 YAML 한 장으로 자동화.
- **오픈소스에 기여하거나 포크해서 쓰고 싶은 개발자.** TypeScript 기반이며 모듈 확장은 보통 1~2개 파일로 끝난다.

## 무엇이 기본 경험인가

1. **설치가 한 줄이고 연결은 명시적이다.** `npx airmcp init`은 로컬 설정만 만들고, 사용자가 동의한 클라이언트만 이후에 연결한다.
2. **쓰는 만큼 다음 수를 더 잘 추천한다.** 사용 패턴이 축적되면 `proactive_context`와 `suggest_next_tools`가 다음 단계를 제안한다. 학습이 아니라 빈도·순서쌍 기반 추천.
3. **시키는 대로만 움직인다.** destructive 작업은 호출마다 HITL 승인을 받고, 기본 거버넌스 경로의 호출 결과는 HMAC 체인 감사 로그에 남는다. 감사 저장소가 권한을 증명하지 못하면 승인 기반 mutation은 실패한다.
4. **스킬로 굳는다.** 반복하는 흐름은 YAML로 저장해 트리거(시간·이벤트·호출)로 자동 실행.
5. **애플 AI를 그대로 쓴다.** Foundation Models·Vision OCR·NLContextualEmbedding·Speech — 온디바이스 우선.

---

## 브랜드 카피 & 톤

**포지셔닝 (locked, 2026-07-24)**

- **우선 타깃:** 파워 애플 유저 (프로슈머) — 이미 Apple에 데이터를 다 넣어놓은 사람
- **정체성:** Apple 생태계를 위한 통제형 MCP 런타임이자 AI 클라이언트와 Apple 앱 사이의 connector/control layer
- **현재 제공 상태:** macOS available, iOS/iPadOS preview, visionOS/watchOS roadmap
- **검색 헤드라인:** `Governed MCP for the Apple ecosystem.`
- **핵심 태그라인 (랜딩):** `Governed MCP for your Apple ecosystem.`
- **핵심 태그라인 (README):** `Governed MCP runtime for the Apple ecosystem.`
- **플랫폼 원칙:** `for macOS`를 제품명이나 영구 정체성으로 쓰지 않는다. macOS는 설치 요건·현재 가용성·검색 키워드에만 정확하게 남긴다.
- **숫자 원칙:** 전체 툴·모듈 수는 기술 레퍼런스에서만 정확히 표기한다. README/문서 사이트/랜딩의 히어로, SEO·소셜 메타데이터, 레지스트리·패키지 설명, `llms.txt` 첫 문단에는 두지 않는다.
- **톤의 성격:** 도구는 도구로 말한다. "AI가 나를 안다"는 인격화는 사용 안 함 — AirMCP는 **노출하고**, 아는 건 AI의 몫.

**Hero 카피 (랜딩, 프로슈머 대면)**

```
Apple 생태계를 위한 통제형 MCP.
Claude, Codex, Cursor 등 MCP 클라이언트를 Apple 앱에 연결합니다.
macOS에서 지금 사용할 수 있으며 iOS는 프리뷰입니다.
```

영문:

```
Governed MCP for your Apple ecosystem.
Connect Claude, Codex, Cursor, and other MCP clients to Apple apps.
Available on macOS, with iOS in preview.
```

Apple MCP라는 카테고리와 실제 제품 역할을 먼저 말하고, 현재 가용성과 앱 이름으로 범위를 구체화한다. Siri 비교는 하단 `Beyond Siri` 섹션에서만 보조적으로 사용한다.

**Hero 카피 (README, 개발자 대면)**

```
Governed MCP runtime for the Apple ecosystem.
AirMCP is the connector and control layer, not another agent.
Profiles, progressive discovery, per-call approval, HMAC-chained audit logs,
rate limits, OAuth scopes, and local controls govern Apple workspace actions.
```

`Apple MCP`는 검색 가능한 카테고리이고, `governed connector/control layer`는 제품 차별점이다. `macOS`는 현재 배포 현실을 설명하지만 제품 범위를 규정하지 않는다.

**3-surface 톤 모델 (표면마다 다른 목소리)**

| Surface                                  | 톤                            | 누구에게                             | 카피 예시                                                                                           |
| ---------------------------------------- | ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 랜딩·소개 (`docs/index.html`)            | 프로슈머 메이커 + 애플 미니멀 | Apple 앱에 AI를 연결하려는 파워 유저 | "Governed MCP for your Apple ecosystem." + 현재 플랫폼 상태 + 주요 앱 이름                          |
| GitHub README·개발자 문서 (`docs/site/`) | 건조·정확·런타임 레이어 강조  | MCP 서버를 포크·확장할 개발자        | "Governed MCP runtime for the Apple ecosystem." + connector/control layer + 통제 기능 + 플랫폼 역할 |
| Skills 가이드·블로그·릴리즈 노트         | 오픈소스 커뮤널 (투명성)      | 공통                                 | 실사용 예시, 로드맵 공개, 기여 초대                                                                 |

한 문서가 두 청중을 동시에 설득하려 하지 않는다. 랜딩은 감정, docs는 스펙·레이어, 블로그는 투명성 — 각 표면이 자기 일만 한다.

## 플랫폼 전략

| 플랫폼       | 상태    | 역할                                                                     |
| ------------ | ------- | ------------------------------------------------------------------------ |
| macOS        | 제공 중 | 전체 로컬 MCP 런타임과 광범위한 Apple 앱·시스템 제어                     |
| iOS / iPadOS | 프리뷰  | Calendar·Reminders·Contacts·Health·Location 네이티브 실행과 AppIntents   |
| visionOS     | 로드맵  | 공간형 상호작용과 네이티브 액션, Mac 전용 자동화는 연결된 Mac으로 라우팅 |
| watchOS      | 로드맵  | 명령·알림·호출별 승인, 실행은 페어링된 iPhone 런타임과 분담              |

모든 OS에 macOS 서버를 복제하지 않는다. 공용 Swift·AppIntents·통제 계약을 공유하고, 샌드박스와 백그라운드 수명에 맞춰 실행 위치를 분리한다. 미출시 플랫폼을 지원된 제품처럼 쓰지 않는다.

---

## 현재 상태

수치는 이 문서에 적지 않는다. `npm run stats`가 코드에서 직접 집계한다 —
모듈·툴·프롬프트·리소스·Skills·AppIntents·AppEnum 전부.
2026-07-11에 박아 둔 표가 5개 항목에서 틀어진 채 47일간 초록으로 남아 있었던 이유는
`scripts/count-stats.mjs`의 동기화 대상 14개 파일에 이 문서가 없었기 때문이다.

|           |                                                                                             |
| --------- | ------------------------------------------------------------------------------------------- |
| 지원 표면 | macOS = 제공 · iOS = 프리뷰 · visionOS/watchOS = 로드맵                                     |
| 패키징    | npm (`airmcp`) · `.mcpb` Desktop Extensions · 서명·공증된 macOS 앱 ZIP                      |
| Transport | stdio · HTTP(+bearer) · OAuth 2.1 + PKCE + Resource Indicators                              |
| 통제      | HITL 듀얼채널 · 감사 로그 JSONL + HMAC chain + correlation id · rate limit + emergency-stop |
| 검증      | 계약 기반 Jest·Swift 게이트 + 실제 npm/MCPB/app 산출물 게이트                               |

`podcasts` 모듈은 macOS 26 이상에서 등록되지 않는다 (Apple이 Podcasts JXA 딕셔너리 제거).

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

## 관련 문서

- [`docs/ledger.md`](ledger.md) — **작업 항목의 유일한 정본.** 열린 부채·처분·오너 결정 대기가 전부 여기 있다.
- [`docs/state.md`](state.md) — 내부 전략 판단의 정본 (운영 모드·가설의 무덤).
- [`docs/rfc/`](rfc/) — 설계 결정 기록.
- [GitHub Issues](https://github.com/heznpc/AirMCP/issues) — 외부에서 도착한 신호.
