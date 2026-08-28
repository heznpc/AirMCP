# 부채 원장 (Debt Ledger)

> **이 저장소의 유일한 TODO 정본이다.** 작업 항목은 여기에만 존재한다.
> `docs/direction.md`는 정체성·원칙의 정본이고, `docs/state.md`는 전략 판단의 정본이며,
> 둘 다 작업 항목을 담지 않는다. `npm run ledger:check`가 CI에서 이를 강제한다.

## §0 규칙

### 0.1 진입 게이트 — 넷 중 하나를 통과해야 등재된다

| 게이트 | 조건                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| **G1** | 코드나 승인된 결정이 이미 존재하는데 `main`에 없다 (브랜치·워크트리·Accepted RFC) |
| **G2** | 재현 명령이 있고 실제로 재현된다                                                  |
| **G3** | 오너 권한 없이는 풀 수 없다                                                       |
| **G4** | 무인 유지 자동화가 멈춘 것을 관측했다                                             |

"앞으로 만들 것"은 게이트를 통과하지 못한다. 그것이 이 원장의 목적이다 —
`docs/state.md` §4가 동결한 선제적 확장의 유일한 유입 경로가 "TODO가 비어서 불안한 세션"이었다.

### 0.2 필수 필드

모든 항목은 다음 다섯을 갖는다. 하나라도 없으면 `ledger:check`가 실패한다.

- **처분**: `LAND` / `FIX` / `KILL` / `ESCALATE` / `AUTOMATE` 중 하나
- **게이트**: G1~G4 중 하나
- **근거**: 파일명 + **검색 가능한 심볼·문자열**. 줄번호 단독 금지 — 줄번호는 리팩터 한 번에 전량 거짓이 된다
- **검증**: 그대로 붙여넣어 돌릴 수 있는 명령. `$`로 시작한다
- **기한**: `ESCALATE`만 필수. 나머지는 `-`

### 0.3 ESCALATE 계약

질문 1개 + 기본값 1개 + 기한 1개가 없으면 `ESCALATE`가 아니다.
기한 경과 시 **곧바로 실행하지 않는다** — 1회 통지하고 7일 재대기한 뒤 기본값을 적용한다.
비가역 작업(브랜치 삭제, force push, hard reset, 대량 삭제, 새 공개 표면 최초 발행)은
기본값 자동 적용에서 **영구 제외**한다. 오너 명시 응답으로만 실행된다.

### 0.4 손대기 전 재현

항목을 착수하는 세션은 **수정보다 먼저 `검증` 명령을 돌린다.**
재현되지 않으면 수정하지 말고 §5에 사인과 함께 종결한다.

단, TTL 자연사(§0.5)로 종결할 때는 **재현 실패 1회로 닫지 않는다.**
원래 `검증` 명령과 독립적으로 작성한 두 번째 재현 명령을 만들어 둘 다 실패해야 종결한다.
잘못된 검증 명령은 잘못된 수정보다 위험하다 — 이 원장의 첫 항목 L-002가
"백슬래시 1개" 처방으로 인계됐다가 실측에서 여전히 0건이었고,
그 처방을 검증 필드에 넣었다면 살아 있는 결함이 "자연사"로 영구 종결됐을 것이다.

### 0.5 TTL

`검증` 명령이 30일 이상 실행되지 않은 항목은 `stale-evidence`로 표기된다.
표기된 항목은 착수 전 §0.4의 이중 재현을 거친다.

### 0.6 원장이 비면 정지한다

활성 항목이 0이면 새 항목을 발명하지 않는다. 다음 세 쿼리만 돌리고 멈춘다.

```bash
gh issue list --state open
gh pr list --state open
gh run list --status failure --limit 10
```

셋 다 비어 있으면 그것이 정답이다. `docs/state.md` §4가 그렇게 정했다.

### 0.7 상한

활성 항목 20개. 초과하면 `ledger:check`가 경고한다(차단하지 않는다 —
외부 이슈가 몰릴 때 CI를 깨면 §4①의 지출을 자동화가 방해한다).

---

## §1 LAND — 코드는 존재하는데 main에 없다

### L-001 · `ui_type` 입력값이 감사 체인에 평문으로 봉인된다

- **처분**: LAND · **게이트**: G1 · **기한**: -
- **근거**: `src/shared/privacy-sensitive-tools.ts`의 UI 민감 목록이 `/^ui_(read|traverse|diff|accessibility)/i`뿐이다. `ui_type`의 `text`(사용자가 타이핑한 비밀번호)와 `ui_perform_action`의 `actionValue`가 걸리지 않아 HMAC 감사 체인에 그대로 봉인된다. 수정본 + 테스트 67줄이 로컬 브랜치 `claude/ui-hardening`의 `10c083f`(감사 리댁션) + `c056847`(포커스 탈취·타게팅)에 있고, 이 브랜치는 원격에 푸시된 적이 없다.
- **검증**: `$ git show origin/main:src/shared/privacy-sensitive-tools.ts | grep -n 'ui_'`
- **비고**: 같은 브랜치의 `3be0ad5`(신규 도구 `accessibility_status` + 출력 스키마 11종)와 `a878d35`(schemas.ts 추출)는 §4 동결 대상이므로 함께 가져오지 않는다 → L-011.

### L-002 · typescript peer 상한 가드

- **처분**: LAND · **게이트**: G1 · **기한**: -
- **근거**: `typescript-eslint`의 peer가 `<6.1.0`인데 `package.json`의 `typescript`가 `^6.0.2`다. TS 6.1이 나오면 락파일 갱신 한 번에 `main`의 lint가 PR 없이 조용히 깨진다. 수정(`~6.0.2`) + `tests/toolchain-peer-range.test.js`가 워크트리 `festive-chebyshev-4f8ab5`에 미커밋 상태로 있다. 2026-07-30 검증 완료 후 28일 대기.
- **검증**: `$ node -e "const t=require('typescript-eslint/package.json').peerDependencies.typescript,d=require('./package.json').devDependencies.typescript;console.log({peer:t,declared:d})"`
- **비고**: 같은 워크트리에 섞인 `docs/state.md` 개정본은 분리하고 커밋하지 않는다.

---

## §2 FIX — 재현된 결함

### L-003 · `recent_files`가 항상 0건 (이슈 #460)

- **처분**: FIX · **게이트**: G2 · **기한**: -
- **근거**: `src/finder/scripts.ts`의 `recentFilesScript`가 생성하는 JXA에 `kMDItemContentModificationDate >= $time.iso(...)`가 들어가는데, `doShellScript`가 이를 `/bin/sh`로 넘겨 `$time`이 변수 확장으로 사라진다.
- **검증**: `$ node -e "import('./dist/finder/scripts.js').then(m=>console.log(m.recentFilesScript({folder:process.env.HOME,days:7,limit:5})))" | grep -o '[\\\\]*\$time'`
- **처방 (실측 확정)**: 인계된 "`\$time`(백슬래시 1개)" 처방은 **동작하지 않는다.** osascript 실측 결과 `$time` → 0건, `\$time` → 0건, `\\$time` → 5건. 이스케이프가 두 겹(JXA 작은따옴표 문자열 → sh)이기 때문이다. TS 소스에 백슬래시 4개(`>= \\\\$time.iso(`)를 써서 생성 스크립트에 `\\$time`이 나오게 해야 한다. `src/shared/esc.ts`의 `escJxaShell`이 `$`에 대해 이미 하는 매핑과 동일하다.
- **회귀 테스트**: 생성 스크립트에 `\\$time`(백슬래시 2개)이 있는지 단언한다. `\$time`을 단언하면 깨진 출력에 대해 통과해 버그를 봉인한다.

### L-004 · `search_files` / `recent_files`가 `folder` 생략 시 0건 (이슈 #459)

- **처분**: FIX · **게이트**: G2 · **기한**: -
- **근거**: Zod v4에서 `.default()`가 `~` 확장 `.transform()`을 우회해 `~` 리터럴이 `mdfind -onlyin`에 그대로 전달된다.
- **검증**: `$ gh issue view 459 --json body -q .body`

### L-005 · `podcasts` 모듈이 macOS 27에서 게이트를 탈출한다

- **처분**: FIX · **게이트**: G2 · **기한**: -
- **근거**: `src/shared/compatibility.ts`가 `brokenOn` 배열을 **정확일치**로 검사한다. `podcasts`의 `brokenOn: [26]`은 `osVersion === 27`에서 발화하지 않아 `register-with-deprecation`이 반환되고, 동작 불가능한 6개 툴이 등록된다. `docs/rfc/0014-scope-review.md`의 Accepted 결정("v3.0 cut까지 명확한 에러 반환")을 조용히 위반 중이다.
- **검증**: `$ node -e "import('./dist/shared/compatibility.js').then(m=>[25,26,27,28].forEach(v=>console.log(v, JSON.stringify(m.resolveModuleCompatibility('podcasts', v)))))"`
- **처방 (실측 확정)**: `src/shared/modules.ts`의 `podcasts` compatibility에 `maxMacosVersion: 25` 한 줄 추가. `compatibility.ts`는 이미 `maxMacosVersion`을 선언하고 `osVersion > c.maxMacosVersion` 분기를 갖고 있어 엔진 변경이 없다. 25/26/27/28 전 구간에서 `register-with-deprecation` / `skip-broken` / `skip-unsupported` / `skip-unsupported`로 무회귀 확인됨.

### L-006 · Swift 브리지 부재를 "Apple Intelligence 미지원"으로 오진한다

- **처분**: FIX · **게이트**: G2 · **기한**: -
- **근거**: npm 패키지는 `files: ["dist"]`라 Swift 브리지를 담지 않고 postinstall도 빌드하지 않는다. 그런데 `src/shared/swift.ts`의 브리지 부재 경로가 `Apple Intelligence requires macOS 26+ with Apple Silicon`을 반환한다. macOS 27 + Apple Silicon에서 `speech_availability` 호출로 직접 재현됨 — 사용자가 하드웨어를 의심하게 만드는 오진이다.
- **검증**: `$ node -e "const p=require('./package.json');console.log(p.files, p.scripts.postinstall)"`

### L-007 · `gws_*` 계약 테스트가 네트워크에 의존한다

- **처분**: FIX · **게이트**: G2 · **기한**: -
- **근거**: `src/google/gws.ts`의 `resolveGwsBinary`가 `gws` 부재 시 `npx`로 폴백하고 `-y @googleworkspace/cli`를 붙여 **호출마다 네트워크 페치**를 돌린다. `src/shared/constants.ts`의 `TIMEOUT.GWS`(15s)가 `tests/runtime-error-contract.test.js`의 계약 예산(10s)보다 커서, 느린 페치가 도구 자체 타임아웃보다 먼저 계약을 깬다. 격리 실행에서도 재현된다(1회차 실패 95.2s / 2회차 통과 88.4s). 타임아웃 집합은 실행마다 달라지는 `gws_*`의 부분집합이다 — 경합 플레이크가 아니라 설계 결함이다.
- **검증**: `$ npx jest tests/runtime-error-contract.test.js --runInBand`
- **비고**: 자동 이슈 생성 게이트를 도입하기 **전에** 이것부터 닫는다. 신뢰할 수 없는 CI 위에 자동 이슈 생성을 얹으면 유령 부채를 스스로 생산한다.

---

## §3 ESCALATE — 오너만 풀 수 있다

### L-008 · add-on 12종 npm Trusted Publisher 등록

- **처분**: ESCALATE · **게이트**: G3 · **기한**: 기본값 없음 — 상주
- **질문**: 등록을 진행합니까, 아니면 add-on 12종 발행을 중단합니까?
- **기본값**: **없음.** 오너 npm 계정 외 실행자가 존재하지 않는다.
- **근거**: `.github/workflows/cd.yml`의 발행 잡이 `NPM_TOKEN` 시크릿 하나에 의존한다. add-on 12종(`@heznpc/airmcp-*`, `src/shared/module-packs.ts`에 등재)이 같은 경로로 나가며, npm이 예고한 bypass-2FA 토큰 제한 시점(2026-08)이 도래했다.
- **검증**: `$ npm access list packages @heznpc 2>&1 | head`

### L-009 · 스테일 브랜치 5종 처분

- **처분**: ESCALATE · **게이트**: G3 · **기한**: 상주 (비가역 — 자동 적용 금지)
- **질문**: `codex/fix-execution-host-permissions` · `codex/fix-app-resource-bundle` · `fix/notarize-api-key-auth` · `claude/chatgpt-local-control-mcp-867bbe` · `quarantine/unscoped-rename` 중 무엇을 삭제합니까?
- **기본값**: 내용이 `main`에 이미 착지한 것만 삭제. 나머지는 존치.
- **근거**: `codex/fix-execution-host-permissions`는 #450으로 착지했고 `main`보다 181커밋 뒤라 되살리면 `main` 작업을 되돌린다. `quarantine/unscoped-rename`(언스코프 패키지명 전환)은 §4가 동결한 "신규 유통 시도"에 해당하므로 무기한 격리가 기본이다.
- **검증**: `$ git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads/ | grep -E 'codex/|quarantine/|chatgpt-local'`

### L-010 · `src/skills/scheduler/*` 607줄 처분

- **처분**: ESCALATE · **게이트**: G3 · **기한**: 상주
- **질문**: 그대로 두고 로드맵 항목만 삭제합니까, 코드·테스트를 제거해 유지 표면을 줄입니까?
- **기본값**: **그대로 둔다.** 삭제는 되돌리기 비용이 있어 명시 지시 없이 하지 않는다.
- **근거**: `cron.ts`/`state.ts`/`queue.ts`/`env.ts`/`index.ts` 607줄과 테스트 4종이 있으나 `src/` 안에서 이를 import하는 파일이 0개다. 스키마 필드 `on_schedule`·`hitl_policy`도 읽는 코드가 없다. 근거로 지목된 "RFC 0012"는 **문서가 존재한 적이 없다** — `docs/rfc/README.md`가 0012를 `reserved, RFC doc pending`으로 표기한다.
- **검증**: `$ grep -rn "skills/scheduler" src/ | grep -v '^src/skills/scheduler/'`

### L-011 · `claude/ui-hardening` 나머지 2커밋 처분

- **처분**: ESCALATE · **게이트**: G3 · **기한**: 2026-09-26 (통지 후 7일 재대기)
- **질문**: `3be0ad5`(신규 도구 `accessibility_status` + `ui_*` 출력 스키마 11종)와 `a878d35`(schemas.ts 추출)를 살립니까?
- **기본값**: **폐기.** 신규 도구 추가와 스키마 확장은 `docs/state.md` §4가 동결한 선제적 기능 확장이다. L-001의 보안 수정 2커밋만 분리 착지시킨다.
- **근거**: `3be0ad5`가 `src/ui/tools.ts`에 `accessibility_status`를 신설하고 `src/ui/schemas.ts`를 새로 만든다. `main`에 두 심볼 모두 부재. 브랜치는 `main`보다 87커밋 뒤라 42파일 전량 리베이스 비용이 크다.
- **검증**: `$ git log --oneline origin/main..claude/ui-hardening`

### L-012 · 서명 앱 릴리스 레인의 정본 확정

- **처분**: ESCALATE · **게이트**: G3 · **기한**: 2026-09-13 (GitHub 배포 승인 30일 만료)
- **질문**: 대기 중인 `release-app.yml` 실행을 승인해 CI 레인을 한 번 완주시킵니까, 취소하고 로컬 서명·공증을 정본으로 문서화합니까?
- **기본값**: **로컬 정본으로 문서화.** 같은 워크플로의 완료된 실행이 전부 failure이고, 출하된 zip 3개(v2.16.3/4/5)는 전부 업로더가 오너 본인이다. CI 레인이 아티팩트를 생산한 사례가 0건이다.
- **근거**: `README.md`의 "signed + notarized" 문구와 `docs/RELEASE_CHECKLIST.md` §3.5가 CI 레인을 전제하는데 실측과 어긋난다.
- **검증**: `$ gh run list --workflow=release-app.yml --limit 10`

### L-013 · v3.0.0 Target을 단 RFC 4종

- **처분**: ESCALATE · **게이트**: G3 · **기한**: 2026-09-26
- **질문**: RFC 0008/0009/0010/0014의 `Target: v3.0.0`을 `unscheduled`로 강등합니까?
- **기본값**: **강등.** v3.0은 마일스톤도 브랜치도 CHANGELOG 항목도 없다. 존재하지 않는 릴리스를 겨냥한 Target 필드는 §0.1 진입 게이트 판정을 흐린다.
- **근거**: `docs/rfc/0008-elicitation.md`·`0009-iwork-depth.md`·`0010-progressive-disclosure.md`·`0014-scope-review.md`의 헤더 블록이 `Target: v3.0.0`을 선언한다. `CHANGELOG.md`에 3.0 항목이 없고 `gh release list`에도 없다. 같은 헤더 관행으로 `0008`·`0009`는 태그된 적 없는 `v2.13.0`을 겨냥하고 있다.
- **검증**: `$ grep -n 'Target' docs/rfc/*.md`

---

## §4 AUTOMATE — 무인 유지가 멈춘 것

### L-014 · PR #442의 필수 체크가 17일째 레드로 굳어 있다

- **처분**: AUTOMATE · **게이트**: G4 · **기한**: -
- **근거**: **CI 파손이 아니다.** 2026-08-14T08:00:04~05Z에 `codeload.github.com`이 핀 고정된 액션 tarball 2개(`gitleaks-action`, `fetch-metadata`)를 배급하지 못한 GitHub 측 일시 장애다. 서로 다른 워크플로·러너 OS에서 1.5초 간격으로 같은 오류가 났고, 같은 gitleaks SHA로 그날 07:49와 08-16 `main` CI는 success였다. **코드 변경 0줄, 재실행 1회로 종결된다.** 워크플로를 뜯어볼 이유가 없다.
- **검증**: `$ gh pr checks 442`

### L-015 · MCP Registry 엔트리가 4패치 낡았다

- **처분**: AUTOMATE · **게이트**: G4 · **기한**: -
- **근거**: `server.json`은 이미 2.16.5인데 레지스트리 엔트리는 2.16.1이다. v2.16.2~v2.16.5 릴리스에 대해 `publish-registry` 워크플로 **실행 자체가 없다** — 트리거가 발화하지 않았다. 하위 애그리게이터가 레지스트리를 크롤하므로 대외 표면이 4패치 낡아 있다.
- **검증**: `$ gh run list --workflow=publish-mcp-registry.yml --limit 10`

### L-016 · stale 봇이 유일한 외부 버그 신고 2건을 폐기 예정이다

- **처분**: AUTOMATE · **게이트**: G4 · **기한**: -
- **근거**: `.github/workflows/stale.yml`의 `exempt-issue-labels`에 `bug`가 있으나 #459·#460은 `labels: []`로 접수됐다. `blank_issues_enabled: true`라 템플릿을 우회한 유입이 라벨 없이 들어온다. 30일 + 7일 규칙상 2026-09-27경 자동 폐기된다. **지출 1순위 대상을 자동화가 지우는 상태다.**
- **검증**: `$ gh issue view 459 --json labels -q .labels`
- **처방**: ① 두 이슈에 `bug` 라벨 부착 ② `blank_issues_enabled: false` ③ `exempt-pr-labels`에 `dependencies` 추가 (같은 봇이 라벨 하나뿐인 PR #442도 지운다)

---

## §5 종결 기록 — 사인(死因)

닫힌 항목은 여기 남는다. **되살리려면 새 외부 증거가 §5에 먼저 추가돼야 한다.**
`wontfix`로 닫는 항목에는 날짜가 아니라 **외부에서 관측 가능한 부활 트리거**를 단다.
"언젠가"·"여유 생기면"은 트리거가 아니다.

| 항목                                                                         | 종결일     | 사인                                                                                                                                                                                                                                      | 부활 트리거                                          |
| ---------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `capture_screenshot` 프로세스 신원 불일치                                    | 2026-08-27 | 자연사 — PR #450으로 이미 착지. `src/shared/setup.ts`의 `JXA_PERMISSION_PROBE`가 osascript 실행 호스트를 직접 프로브한다                                                                                                                  | 프로브가 실행 호스트 아닌 것을 보게 되면             |
| `capture_screenshot` TCC 재부여 필요                                         | 2026-08-27 | 자연사 — 실행 호스트 프로브 `{screenRecording:true, accessibility:true}`, 실제 캡처 656KB PNG 성공                                                                                                                                        | 캡처가 권한 오류로 실패하면                          |
| direction.md 「로드맵 (v2.12 → v3.0)」 절 전체                               | 2026-08-27 | 2026-07-11 이후 미갱신. 앵커 버전 v2.13이 태그된 적 없음(CHANGELOG가 2.12.0 → 2.14.0). v2.16.x 실질 작업(RFC 0015 task harness·모듈 팩·universal distribution) 전량 누락. "할 일"만 담고 "한 일"을 흡수하지 않는 구조라 영구적으로 틀린다 | 없음 — 이 원장이 대체한다                            |
| 백로그 「C5 음성 엔드투엔드」                                                | 2026-08-27 | 저장소 전체 유일 히트가 direction.md 자기 자신. 목적("진짜 Siri 대체 증명")이 direction.md 브랜드 규칙 및 state.md §3과 충돌                                                                                                              | Apple이 서드파티에 핫워드 API를 개방하면             |
| 백로그 「MCP Apps 확장 (Photo Memory / Health Dashboard / Workflow Result)」 | 2026-08-27 | 명명된 3종 전부 부재. 실재하는 3종(calendar-week, music-player, timeline-today)과 무관한 위시리스트. G1~G4 미통과                                                                                                                         | 외부에서 특정 MCP App을 요청하는 이슈가 접수되면     |
| 백로그 「HomeKit Phase 0」                                                   | 2026-08-27 | 조건("6/8에 Apple system MCP 발표 시 재평가")이 RFC 0011에서 79일 전 거짓으로 확정 판정됨                                                                                                                                                 | Apple이 system-level MCP를 발표하면                  |
| 백로그 「Translate / Voice Memos / Books / Stocks 신규 모듈」                | 2026-08-27 | 코드 0건. state.md §4 "선제적 기능 확장" 동결 및 §3 "도구 수" 가설 폐기와 정면 충돌                                                                                                                                                       | 외부 이슈로 특정 모듈이 반복 요청되면                |
| 백로그 「CloudKit private DB 벡터 싱크」                                     | 2026-08-27 | 자기 문서(`docs/ios-architecture.md`)가 CloudKit 직접 접근을 private API로 기록해 두었다. 배경 조사 결과가 이미 부정적                                                                                                                    | Apple이 공개 API를 제공하면                          |
| 「outputSchema Wave 8 focused」                                              | 2026-08-27 | 실행 규칙("read/idempotent만 추려")이 가리키는 집합이 **공집합**. 잔여 31개(문서가 주장한 41이 아님) 중 `annotations.readOnlyHint=true`가 0개이고 전부 mutating 액션                                                                      | 없음                                                 |
| 「RFC 0009 Phase 1 batch 2/3」 + 고아 스모크 2종                             | 2026-08-27 | 검증 대상 PR #204·#214가 2026-05-24 unmerged CLOSED. 10개 verb가 `src/numbers/scripts.ts`에 존재한 적 없음. `scripts/smoke/numbers-rfc0009-batch{2,3}.mjs` 584줄이 아무것도 검증하지 않는다                                               | RFC 0009 Phase 1이 재개되면                          |
| 「RFC 0011 §5 선택 quadrant의 후속 architecture 변경」                       | 2026-08-27 | 근거 문서 자신이 취소했다. RFC 0011 §5.2 Q2 마지막 줄 `No architecture change`, §0.3 `Do NOT build a system-MCP adapter`                                                                                                                  | 없음                                                 |
| 「macOS 26.5 GA 호환성 매트릭스 검증 + CI runner 추가」                      | 2026-08-27 | 마감 5/15가 3개월 반 경과, 플랫폼이 27로 이동. 살아 있는 문제(macOS 27 파손)는 L-005가 실체로 대신한다                                                                                                                                    | CI에 OS 버전 매트릭스를 넣기로 결정하면              |
| PR 템플릿 축소 (`d9caf29`)                                                   | 2026-08-27 | 변경 근거였던 "템플릿이 기여 병목" 가설이 반증됨. 어떤 CI도 QA 산출물을 강제하지 않고(워크플로 히트 0건), 유일한 외부 기여 PR #406은 QA 산출물 없이 머지됐다                                                                              | 외부 기여자가 템플릿을 이유로 이탈한 사례가 관측되면 |

---

## §6 이 원장을 갱신하는 법

1. 새 항목은 §0.1 게이트를 통과해야 하고 §0.2 다섯 필드를 갖춰야 한다.
2. 닫힌 항목은 삭제하지 않고 §5로 옮기며, 반드시 사인과 부활 트리거를 단다.
3. 수치를 담는 문서는 `scripts/count-stats.mjs`의 `syncFile` 목록에 넣거나 수치를 쓰지 않는다.
   `docs/direction.md`가 그 목록 밖에 있어 `stats:check` 초록인 채 5종이 틀렸던 것이 이 규칙의 유래다.
4. `docs/direction.md`·`docs/state.md`·RFC에 작업 항목을 다시 만들지 않는다.
   `npm run ledger:check`가 `## 로드맵` / `## 백로그` / `## TODO` / `- [ ]` 패턴을 이 파일 밖에서 발견하면 실패한다.
5. 브랜치는 **작업 형태**로 분류한다 — `fix/` `docs/` `chore/` `feat/` `test/` `ci/`.
   원장 항목 착수 시 항목 ID를 파생한다(예: `fix/L-003-recent-files`).
   에이전트 이름(`claude/`, `codex/`)으로 시작하는 브랜치를 푸시하지 않는다 —
   하네스가 만든 세션 브랜치는 푸시 전에 rename한다.
