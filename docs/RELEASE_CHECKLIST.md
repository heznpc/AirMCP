# AirMCP Release Checklist

릴리스 때마다 실행하는 체크리스트. **TODO.md ↔ CHANGELOG ↔ 코드 드리프트**를 구조적으로 방지하기 위한 문서. 2026-04-17 QUALITY_DIAGNOSIS의 HIGH-2 대응.

> 목표 시간: patch 릴리스 20분, minor 45분, major 2시간.

---

## 0. 릴리스 종류 결정

SemVer 2.0.0 기준:

| 성격 | 예시 | 버전 증가 |
|---|---|---|
| 버그 픽스, 내부 리팩터링, 문서 | JXA stat 파싱 개선, i18n 키 보완 | patch (x.y.**z**) |
| 신규 툴·모듈, outputSchema 확대, 새 config 키 (백워드 호환) | `generate_image` 추가, `allowNetwork` 선언형 도입 | minor (x.**y**.0) |
| config 스키마 breaking, 툴 시그니처 변경, 기본값 변경 (파괴적) | `allowSendMail` 기본값 변경, `update_reminder.name → title` | major (**x**.0.0) |

Breaking을 포함한 minor/patch는 **금지**. 직전 메이저에 묶어 둘 수 없으면 메이저로 올린다.

---

## 1. 사전 점검 (릴리스 직전)

### 1.1 브랜치·상태
- [ ] `main` 기준에서 시작 (또는 `release/vX.Y.Z` 브랜치)
- [ ] `git status` 클린
- [ ] `git pull --rebase origin main`

### 1.2 로컬 게이트
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test` — 커버리지 게이트(현재 46/40/42/46) 통과 확인
- [ ] macOS 환경이라면 `npm run swift-build` · `npm run swift-test`
- [ ] `npx airmcp doctor` 자체 실행이 성공 (CI 환경 외)

### 1.3 공개 계약 체크
- [ ] `npm run count-stats` — 툴/모듈/리소스 수와 `server.json`·`glama.json`·README·docs/site·i18n이 일치
- [ ] `npm run check-i18n` — 9 로케일 키 동기화 통과
- [ ] `outputSchema` 추가·변경이 있다면 Zod `.safeParse` 테스트가 성공 응답과 에러 응답 모두에 대해 도는지 확인

### 1.4 취약점
- [ ] `npm audit` — high 이상 0건 확인
- [ ] `npm audit --audit-level=moderate` — moderate 건수 기록 (RFC 0003 단계 따라 blocking 여부 판단)
- [ ] 새로 도입된 의존성이 있다면 라이선스 감사 통과

---

## 2. 문서 동기화 — **여기가 드리프트 방지의 핵심**

### 2.1 CHANGELOG.md
- [ ] `## [Unreleased]`에 기록된 항목을 새 버전 섹션으로 이동 (없으면 직접 작성)
- [ ] 분류: `Added` / `Changed` / `Fixed` / `Security` / `Deprecated` / `Removed` / `Breaking Changes`
- [ ] 테스트 변화가 크면 "Testing (N → M tests, coverage X → Y%)" 섹션 추가 (v2.7.2 포맷)
- [ ] Breaking 항목은 **마이그레이션 가이드** 포함 ("envvar/flag가 이렇게 바뀜")
- [ ] 이슈·PR 번호(#NN) 참조

### 2.2 TODO.md (가장 자주 잊히는 곳)
- [ ] CHANGELOG delta와 대조하여 **완료된 항목 체크오프**
  - 테스트 커버리지 구체 수치(%) 갱신
  - "완료" 섹션 맨 위에 새 버전 한 줄 요약 추가
- [ ] 새 버전에서 생긴 후속 작업 P0/P1/P2에 삽입
- [ ] 헤더의 "X.Y.Z 기준 (YYYY-MM-DD 동기화)" 라인 갱신
- [ ] "등록 현황" 테이블의 npm 버전·일자 갱신

### 2.3 버전·메타데이터
- [ ] `package.json` version
- [ ] `package-lock.json` version (npm이 자동 처리)
- [ ] `docs/site/locales/*.json` 버전 문구 (있을 경우)
- [ ] README의 버전·툴 수 언급
- [ ] `.well-known/mcp.json` (제공 시)
- [ ] `server.json` / `glama.json` / `smithery.yaml`

### 2.4 PR 템플릿·이슈 템플릿
- [ ] Breaking 변경이 있다면 이슈/PR 템플릿의 버전 placeholder 갱신

### 2.5 RFC 상태
- [ ] 이 릴리스로 구현 완료된 RFC는 `Status: Accepted → Implemented`로 이동
- [ ] 새로 수용된 RFC는 `Draft → Accepted`로 이동
- [ ] `docs/rfc/README.md`의 목록 테이블 갱신

---

## 3. 릴리스 실행

### 3.1 커밋
- [ ] `chore(release): vX.Y.Z` 커밋에 위 모든 파일 동시 포함
- [ ] `git tag vX.Y.Z` (서명 권장: `git tag -s`)
- [ ] `git push origin main --tags`

### 3.2 CI 통과 확인
- [ ] `ci.yml` 전 단계 green
- [ ] CodeQL·Scorecard 경고 신규 없음

### 3.3 npm publish
- [ ] CD workflow(`cd.yml`) 자동 트리거 확인, 또는 수동 `npm publish --provenance`
- [ ] `npm view airmcp@X.Y.Z` 로 반영 검증
- [ ] `npx -y airmcp@X.Y.Z --version` 스모크

### 3.4 Signed .app + .mcpb → GitHub Release
- [ ] `release-app.yml` 워크플로가 태그 푸시로 자동 실행됐는지 확인 (Actions 탭)
- [ ] 실패 시 **Missing required secrets** 에러면 아래 6개를 Settings → Secrets and variables → Actions에 등록:
  - `APPLE_DEVELOPER_ID` — Developer ID Application certificate 공통명 (예: `Developer ID Application: Jane Doe (A1B2C3D4E5)`)
  - `APPLE_ID` — notarytool용 Apple ID 이메일
  - `APPLE_ID_PASSWORD` — [App-specific password](https://appleid.apple.com) (Sign-in and security → App-specific passwords)
  - `APPLE_TEAM_ID` — 10자리 팀 ID
  - `APPLE_CERT_P12_BASE64` — `.p12` 인증서 + 개인키를 base64 인코딩 (`base64 -i cert.p12 | pbcopy`)
  - `APPLE_CERT_P12_PASSWORD` — `.p12` import 암호
- [ ] 성공 시 Release에 두 산출물 첨부되어 있어야 함:
  - `AirMCP-X.Y.Z.zip` (Developer ID 서명 + 공증 + staple 완료)
  - `airmcp-X.Y.Z.mcpb` (Claude Desktop 원클릭 설치용)
- [ ] 공증 실패 시 Actions 로그의 `notarytool log` 출력에서 거부 사유 확인 (hardened runtime / timestamp / 빠진 entitlement 등)
- [ ] 신호용 검증: `codesign -dv --verbose=4 AirMCP.app` 에서 `Authority=Developer ID Application: …` 확인
- [ ] Gatekeeper 검증: `spctl -a -vvv AirMCP.app` → `accepted, source=Notarized Developer ID`

### 3.5 GitHub Release notes
- [ ] Release notes는 CHANGELOG 섹션 복사 (요약 강조, 이미지/GIF는 README 링크)
- [ ] Breaking이 있으면 Release 제목에 `[BREAKING]` 프리픽스
- [ ] `latest` 태그 갱신 확인

---

## 4. 사후 작업 (release 후 24시간 내)

- [ ] **TODO.md 등록 현황**에 다운스트림 반영 확인
  - cursor.directory 자동 인덱싱 확인
  - PulseMCP / Glama 메타데이터 반영 (필요 시 수동 요청)
- [ ] **doctor 서버 응답** 체크: `.well-known/mcp.json`의 version·authorization 블록 최신화
- [ ] Breaking이 있었다면 README 상단 안내 배너 1주일간 유지
- [ ] 중대한 변경은 GitHub Discussions에 "Announcement" 카테고리로 공지
- [ ] (SNS는 별도 메이저 릴리스에만)

---

## 5. 실패·롤백 시나리오

### 5.1 CI 실패로 릴리스 중단
- [ ] `git tag -d vX.Y.Z` (로컬)
- [ ] `git push origin :refs/tags/vX.Y.Z` (원격에 이미 푸시된 경우만)
- [ ] 원인 픽스 후 동일 버전 번호 재시도 가능 (npm publish 이전이므로)

### 5.2 npm publish 후 결함 발견
- **npm은 72시간 내 `npm unpublish` 가능하지만 생태계 영향이 크다.**
- 가능하면 **신규 patch 릴리스**로 롤-포워드:
  - `vX.Y.Z+1` 준비, CHANGELOG에 "Revert: ..." 명시
  - 이전 버전에 `deprecated` 플래그: `npm deprecate airmcp@X.Y.Z "Please upgrade to X.Y.Z+1 due to <reason>"`
- unpublish가 불가피하면 README·Discussions·Release Notes에 명시

### 5.3 보안 이슈 발견 (배포 후)
- [ ] [SECURITY.md](../SECURITY.md) 프로세스 시작 (GitHub Advisories, CVE 요청)
- [ ] 영향받은 버전에 `npm deprecate`
- [ ] 긴급 패치는 48시간 내 릴리스 목표

---

## 6. 자동화 기회

드리프트를 **사람의 주의력**이 아니라 **CI 게이트**로 막는 작업:

- [ ] **TODO.md 동기화 린터** — CHANGELOG의 `[x]` 체크박스와 TODO.md 상태를 교차검증
- [ ] **버전 sync 검증** (이미 존재: `scripts/verify-versions.mjs` 형태) — CI blocking
- [ ] **Release Drafter** — 이슈·PR 라벨로 CHANGELOG 초안 자동 생성
- [ ] **ts-release-please** 등으로 버전 bump PR 자동화 후보 검토

---

## 부록: 빠른 명령어 치트시트

```bash
# 로컬 게이트
npm run lint && npm run typecheck && npm run build && npm test

# 통계·i18n
npm run count-stats && npm run check-i18n

# 취약점
npm audit --audit-level=moderate

# 릴리스
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin main --tags

# 스모크
npx -y airmcp@X.Y.Z --version
```
