# RFC 0003 — CI npm audit 등급 단계적 상향 & 취약점 대응 SLA

- **Status**: Draft
- **Author**: 두콩 + Claude
- **Created**: 2026-04-17
- **Target**: v2.8.0 ~ v2.8.x
- **Related**: `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, QUALITY_DIAGNOSIS 2026-04-17 MEDIUM-3, LOW-3

---

## 1. Motivation

현재 `ci.yml`은 production 의존성에 대해 `npm audit --audit-level=high --omit=dev`를 blocking으로 걸어 둔다(검증: ci.yml에서 해당 단계 확인). 개발 도구 advisory는 Dependabot과 별도 업데이트로 추적하되, 사용자가 설치하는 runtime dependency가 CI의 hard gate 대상이다. 이 설정에는 두 가지 후속 과제가 있다.

1. **Moderate 등급 취약점이 누적된다.** QUALITY_DIAGNOSIS 단계에서 Hono(`@hono/node-server` 계열) 전이 의존성의 moderate 등급 advisory가 `package-lock.json`에 존재함을 확인했다(검증: `grep -c '"hono"' package-lock.json` = 2). 직접 의존성이 아니므로 `npm audit fix`가 자동 해결하지 못하고, 빌드·CI는 초록불로 유지된다. "알고 있지만 치우지 않는 부채"가 쌓이는 구조.
2. **취약점 발견 → 조치까지의 SLA가 없다.** 지금까지는 릴리스 노트에 보안 픽스가 함께 들어가는 사후 대응 패턴이지만, "48시간 안에 patch를 낸다" 같은 **명시된 약속**이 없다. 사용자·엔터프라이즈 도입 측에서는 이 약속이 도입 결정의 기준.

**목표**: moderate 등급을 단계적으로 blocking으로 끌어올리고, 취약점 등급별 응답 SLA를 공개 계약으로 선언한다.

---

## 2. Proposed Design

### 2.1 3단계 상향 (gradient rollout)

| Phase | 기간 | CI 동작 | 실패 정책 |
|---|---|---|---|
| **Phase 0** | — | production `npm audit --audit-level=high --omit=dev`만 blocking | moderate는 무시 |
| **Phase 1** | v2.8.0 | moderate는 **advisory** (별도 step, continue-on-error) + 매주 요약 | high blocking 유지 |
| **Phase 2** | v2.8.x (Phase 1 클린 2주 유지 후) | moderate **blocking** | 신규 moderate → PR 머지 차단 |
| **Phase 3** | v2.8.x | Socket·Snyk·OSV-Scanner 중 택1 병행 도입 | 겹치는 advisory로 커버리지 확장 |

**Phase 1 구체 구현**:

```yaml
# .github/workflows/ci.yml (부분)
- name: npm audit (high — blocking)
  run: npm audit --audit-level=high --omit=dev

- name: npm audit (moderate — advisory)
  id: audit-moderate
  continue-on-error: true
  run: npm audit --audit-level=moderate --omit=dev --json > audit-moderate.json

- name: Report moderate findings
  if: always()
  run: node scripts/summarize-audit.mjs audit-moderate.json
```

`scripts/summarize-audit.mjs`는 상위 5개 advisory의 패키지·심각도·fix 경로를 stderr로 출력. CI 로그 끝에서 바로 보이도록.

### 2.2 Hono Transitive 취약점 해소 (Phase 1 착수 동시)

세 가지 선택지가 있으며, 순서대로 시도:

**옵션 A — 상위 의존성 버전 범프**
- `package-lock.json`에서 Hono를 끌어들이는 상위 패키지 확인(`npm ls hono`).
- 해당 패키지의 최신 메이저/마이너가 Hono 패치 버전을 요구하는지 검토.
- 가능하면 상위를 올려 해결. **가장 깔끔한 해법**.

**옵션 B — `overrides`로 Hono 강제**
- `package.json`에 `overrides: { "hono": "^<safe-version>" }` 추가.
- 장점: 즉시 적용. 단점: 상위 의존성이 Hono의 새 API를 쓰지 않는 범위에서만 안전.
- 매 릴리스마다 override 필요성 재검토.

**옵션 C — 의존성 자체 제거 시도**
- Hono는 `ext-apps` 관련 일부 경로에서 들어오는 것으로 추정(검증 필요).
- `--http` 모드 미사용 배포에서는 로드되지 않는 경로인지 확인.
- 번들링·tree-shake 설정으로 dist에서 제거 가능하면 **가장 안전**.

기본 전략: A → B → C 순 시도, 2일 내에 결론.

### 2.3 취약점 응답 SLA (Public Commitment)

`SECURITY.md`에 다음 테이블 추가:

| 등급 | 의미 | 응답 시작 | 패치 릴리스 |
|---|---|---|---|
| **Critical** | 원격 코드 실행, 인증 우회, 대량 데이터 유출 | 24시간 이내 | 72시간 이내 |
| **High** | 권한 상승, 파일 유출, DoS | 48시간 이내 | 7일 이내 |
| **Moderate** | 정보 누설, 제한된 영향 | 7일 이내 | 다음 정기 릴리스 |
| **Low / Info** | — | 다음 정기 릴리스에서 검토 | 다음 정기 릴리스 |

- 응답 시작: `SECURITY.md` 절차에 따른 **초동 응답**(접수 확인, 영향 범위 확인 개시).
- 패치 릴리스: 수정 코드가 npm에 publish되는 시점.
- 영업일 기준이 아닌 **calendar hours** 기준. 단일 메인테이너 체제의 한계는 주석으로 명시.

### 2.4 Exception Process

특정 advisory가 **우리 사용 경로에서 활성화되지 않음이 증명**될 때:

- `SECURITY.md`에 `known-false-positives` 섹션 추가 (패키지·advisory ID·이유·재검토 날짜).
- CI audit 단계가 allowlist 지원: `scripts/summarize-audit.mjs`가 `.audit-allowlist.json`을 읽어 해당 advisory ID는 "acknowledged"로 표시, blocking에서 제외.
- allowlist 엔트리는 **최대 90일 TTL**. 만료되면 자동 다시 blocking. TTL 갱신은 매번 리뷰.

### 2.5 장기: 보완 스캐너 병행 (Phase 3)

`npm audit`만으로는 아래 한계:
- advisory DB가 GitHub Advisory에만 의존
- 라이선스 취약점(예: GPL-only transitive) 놓침
- SCA(Software Composition Analysis) 수준의 심층 분석 부재

후보:
- **Socket** — 유해 동작 탐지(postinstall 스크립트, typo-squatting) 강점
- **Snyk** — 상용이지만 오픈소스 무료 플랜 존재. 수정 PR 자동 생성
- **OSV-Scanner** — Google 오픈소스, 무료, 여러 advisory DB 통합
- **Trivy** — 컨테이너 중심이지만 npm도 지원

기본 추천: **OSV-Scanner** (무료 + 커버리지 넓음 + CI 친화적).

---

## 3. Migration Plan

| 단계 | 작업 | 기간 | Blocking 여부 |
|---|---|---|---|
| 1 | `SECURITY.md`에 SLA 테이블 추가 | 1일 | — |
| 2 | Phase 1 CI step 추가 (moderate advisory) | 0.5일 | 도입 시 advisory only |
| 3 | Hono transitive 해결 (옵션 A/B/C 중 선택) | 2일 | moderate 0건 달성 목표 |
| 4 | `.audit-allowlist.json` 스키마 + 스크립트 | 1일 | — |
| 5 | 2주 관찰 (moderate 클린 유지 확인) | 14일 | — |
| 6 | Phase 2 전환 (moderate blocking) | 0.5일 | ✅ Blocking ON |
| 7 | OSV-Scanner 도입 (advisory) | 1일 | advisory 3개월 관찰 |
| 8 | Phase 3 검토 (OSV blocking 여부) | — | 데이터 기반 결정 |

---

## 4. Alternatives Considered

### 4.1 처음부터 moderate blocking
- 리스크: 현재 존재하는 Hono advisory가 즉시 CI red. 그동안 merge 막힘.
- 이유 있는 실패라면 감내 가능하지만, 그 사이 기능 PR이 밀림.
- **점진적 롤아웃이 낫다.**

### 4.2 audit 완전히 버리고 Socket·Snyk로 대체
- 오픈소스 일급은 `npm audit`. 라이선스 비용 없고 공식 채널.
- 보완은 하되 대체는 아니다.

### 4.3 SLA를 내부 가이드로만 유지
- 도입 결정자·엔터프라이즈는 **공개된 약속**을 본다. internal-only는 효과 절반.

### 4.4 자동 PR (Dependabot/Renovate) 적극 활용으로 취약점 자연 해소
- 이미 Dependabot 존재 (검증 필요). 자동 PR은 의존성 업데이트에 유용하지만 transitive-only 경우엔 무력하다. override와 병행 필요.

---

## 5. Open Questions

1. **Phase 1 → Phase 2 전환 조건**: "moderate 0건 2주 유지"는 괜찮은 heuristic이지만, 신규 advisory가 외부 요인으로 계속 추가되면 영원히 전환 못 할 수 있음. 대안: "알려진 advisory에 대해 조치가 모두 결정(패치/allowlist)된 상태 2주 유지".
2. **단일 메인테이너 한계**: SLA를 공개했는데 휴가·병가 등 커버리지 구멍이 생기면 약속 불이행. 초기 SLA는 **작은 약속에서 시작**하고, 팀이 성장하면 상향. 현재 제안 값은 단일 메인테이너 기준 현실적.
3. **supply chain 공격 (install-time 악성 코드)**: `npm audit`로 감지 어려움. Socket 또는 Phylum 같은 전문 도구가 필요. Phase 3에서 구체화.
4. **postinstall 실행 정책**: 현재 허용. `--ignore-scripts`와 allowlist 조합 검토는 별도 RFC 후보.
5. **CI 시간 증가**: moderate advisory + OSV-Scanner 합산 시 +1~2분 예상. 캐시 전략 필요.

---

## 6. Success Metrics

- **Phase 1 진입 후 4주 내 moderate 0건** 유지
- **알려진 취약점 미해결 기간 중앙값** Critical ≤ 3일, High ≤ 7일, Moderate ≤ 30일
- **SECURITY.md SLA 약속 vs 실제 응답** 90일 윈도에서 괴리 0건
- **false positive 비율**: allowlist 엔트리 유지 기간 평균 < 60일 (즉 근본 해결로 치환되는 경우 多)

---

## 7. Next Steps

1. 본 RFC 리뷰·승인
2. `SECURITY.md` SLA 테이블 PR (단독으로 먼저 가능)
3. Hono 전이 의존성 파악 + 옵션 A/B/C 판정 PR
4. CI moderate advisory step + `summarize-audit.mjs` PR
5. `.audit-allowlist.json` 스키마 + 린터 PR
6. Phase 2 전환 PR (2주 관찰 후)
7. OSV-Scanner 도입 검토 PR (Phase 3)
