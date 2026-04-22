# AirMCP RFCs

AirMCP는 **크로스-커팅한 설계 결정**을 RFC(Request for Comments)로 기록한다. RFC는 "왜 이렇게 만들었는가"를 코드 주석보다 오래 살아남게 하는 장치다.

## 언제 RFC를 쓰는가

RFC가 필요한 경우:

- 공개 계약(툴 응답 shape, config 스키마, `.well-known/mcp.json` 형태)을 바꾸는 변경
- 여러 모듈에 걸친 횡단 관심사(에러 처리·보안 정책·관측성)
- 되돌리기 어려운 결정(데이터 포맷, 파일 경로 규약, SemVer 정책)
- 3인 이상이 리뷰해야 할 큰 구조적 변경

RFC가 **불필요한** 경우:

- 버그 픽스, 단일 모듈 내부 리팩터링, 문구 수정
- 기존 RFC에 이미 합의된 구현의 추가
- 단순 의존성 업데이트 (SDK 마이너·패치)

의심스러우면 우선 Issue로 열어 논의하고, 필요하면 RFC로 승격한다.

## 프로세스

1. **Draft 작성** — `docs/rfc/NNNN-kebab-title.md`로 생성. 번호는 현재 최댓값 + 1. 브랜치 생성 후 PR.
2. **Discussion** — 2주 코멘트 기간(긴급 사안은 단축 가능). 모든 "Open Questions"가 닫혀야 병합.
3. **Accept** — Status: Draft → Accepted. 이 시점에서 구현 PR 착수 가능.
4. **Implement** — 구현 PR에서 해당 RFC 번호를 본문에 참조. 구현 완료 시 Status: Accepted → Implemented.
5. **Amend / Supersede** — 이미 Implemented된 RFC를 크게 바꾸려면 새 RFC를 발행하고 이전 RFC를 `Superseded by NNNN`으로 표기.

## Status 라이프사이클

```
Draft ──► Proposed ──► Accepted ──► Implemented
  │          │             │
  │          ▼             ▼
  └──► Rejected      Superseded
```

- **Draft** — 저자 작성 중, 리뷰 안 받은 상태
- **Proposed** — 코멘트 받는 중
- **Accepted** — 합의됨, 구현 대기
- **Implemented** — 구현 완료 (CHANGELOG에 반영되어야 함)
- **Rejected** — 논의 끝에 채택 안 함 (이유 본문에 남김)
- **Superseded** — 후속 RFC로 대체됨

## 파일 구조 / 템플릿

```markdown
# RFC NNNN — <한 줄 제목>

- **Status**: Draft
- **Author**: <이름>
- **Created**: YYYY-MM-DD
- **Target**: <릴리스 버전>
- **Related**: <파일·링크·이전 RFC>

## 1. Motivation

## 2. Proposed Design

## 3. Migration Plan

## 4. Alternatives Considered

## 5. Open Questions

## 6. Success Metrics

## 7. Next Steps
```

- 길이 목표 **300줄 이내**. 길어지면 분리하거나 보조 문서로 분할.
- 코드 예시는 "이게 이상적" 수준이면 충분. 구현 세부는 PR에서.
- Success Metrics가 적기 어려우면 RFC로 쓸 정도의 범위인지 먼저 되물어본다.

## 번호 지정 규칙

- 4자리 영문 대문자 패딩 (`0001`, `0002`, …)
- 순서는 제출 시점 기준이며, Rejected된 번호도 **재사용하지 않는다** (역사적 기록 유지)
- 번호 충돌은 먼저 PR 올린 쪽 우선, 뒤늦게 올린 쪽이 다음 번호로 양보

## 현재 RFC 목록

| # | 제목 | Status | 대상 버전 |
|---|---|---|---|
| [0001](./0001-error-categories.md) | Error Categories & Tool Error Contract | Draft | v2.8.0 |
| [0002](./0002-http-allow-network.md) | Declarative HTTP `allowNetwork` Mode | Draft | v2.8.0 → v2.9.0 |
| [0003](./0003-ci-audit-stepwise.md) | CI npm audit 등급 단계적 상향 | Draft | v2.8.x |
| [0004](./0004-macos-compat-matrix.md) | macOS 호환성 매트릭스 & 모듈 Manifest 확장 | Draft | v2.8.0 |
| [0005](./0005-oauth-resource-indicators.md) | OAuth 2.1 + Resource Indicators (MCP 2025-06-18 spec) | Draft | v2.11.0 |

## 관련 문서

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — 코드 기여 가이드
- [GOVERNANCE.md](../../GOVERNANCE.md) — 프로젝트 거버넌스
- [CHANGELOG.md](../../CHANGELOG.md) — 릴리스별 실제 변경 내역
- [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md) — 릴리스 절차
