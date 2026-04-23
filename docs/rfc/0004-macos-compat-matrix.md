# RFC 0004 — macOS 호환성 매트릭스 & 모듈 Manifest 확장

- **Status**: Accepted — runtime activation (`resolveModuleCompatibility`, `print-compat-report`, `doctor` integration, Safari `add_bookmark` gated) shipped in v2.10.0
- **Author**: 두콩 + Claude
- **Created**: 2026-04-17
- **Target**: v2.8.0
- **Related**: `src/shared/modules.ts`, `src/safari/tools.ts:260-278` (add_bookmark), `src/podcasts/tools.ts`, `src/intelligence/tools.ts` (minMacosVersion: 26), QUALITY_DIAGNOSIS 2026-04-17 HIGH-4

---

## 1. Motivation

AirMCP는 macOS 버전별 기능 차이가 큰 플랫폼(EventKit, HealthKit, Apple Intelligence, Safari scripting, Podcasts JXA dictionary 등)을 추상화한다. 현재 호환성 대응은 두 가지 서로 다른 방식이 **불완전하게** 섞여 있다.

**방식 A — 모듈 레벨 `minMacosVersion`**
- `src/intelligence/` 모듈은 manifest에서 `minMacosVersion: 26`을 선언.
- `mcp-setup.ts`가 시작 시 OS 버전을 검사해 미달 시 모듈을 로드하지 않음.
- 장점: 에이전트가 "존재하지 않는" 툴을 잘못 선택할 일이 없음.

**방식 B — 툴 레벨 런타임 에러**
- `safari.add_bookmark`는 macOS 26에서 제거된 JXA dictionary에 의존.
- 여전히 등록되어 있고, 호출되면 런타임에 에러 메시지 반환 ("deprecated, use add_to_reading_list").
- 문제: 에이전트 관점에서 **“항상 실패하는 툴”이 목록에 존재**. 계획 단계에서 잘못 선택되기 쉽다.

**방식 C — 문서에만 표기**
- Podcasts 모듈은 `TODO.md`에는 "macOS 26+에서 JXA dictionary 제거"로 적혀 있지만, 소스 코드에는 `deprecated`·`unsupported_os` 마킹이 없다. 툴은 그대로 등록·작동한다 (실패율은 환경에 따라 다름).
- 문서와 코드의 드리프트. 외부 기여자·사용자가 파악할 길이 없다.

게다가 호환성은 **"macOS 버전"** 하나만이 아니다:
- 권한 상태 (Full Disk Access, Accessibility, Automation prompts)
- 하드웨어 (Apple Silicon vs Intel, camera, microphone, Neural Engine)
- 동시 실행 가능 앱(모듈)의 유무

**목표**:
1. 모듈·툴 단위 호환성 정보를 **manifest에 선언적으로** 표현
2. 시작 시 OS 버전에 따라 모듈·툴을 **동적으로 등록 여부 결정**
3. 에이전트가 `discover_tools`·`.well-known/mcp.json`에서 **제거된/비호환 툴을 사전에 알 수 있게** 노출
4. deprecated 툴의 **제거 일정**을 코드에 명시

---

## 2. Proposed Design

### 2.1 Module Manifest 스키마 확장

`src/shared/modules.ts`의 MANIFEST 엔트리를 다음 형태로 확장:

```ts
export interface ModuleManifest {
  id: string;
  loader: () => Promise<unknown>;

  // 기존 (일부 모듈에만 있음)
  minMacosVersion?: number;        // 예: 26

  // NEW — RFC 0004
  maxMacosVersion?: number;        // 제거된 스펙
  status?: ModuleStatus;           // 'stable' | 'beta' | 'deprecated' | 'broken'
  brokenOn?: number[];             // 특정 버전들에서 동작 불가 (예: [26.0])
  requiresPermissions?: Permission[]; // ['automation.Notes', 'accessibility', …]
  requiresHardware?: Hardware[];   // ['apple-silicon', 'neural-engine', 'camera']
  deprecation?: {
    since: string;                 // 버전 (AirMCP)
    removeAt: string;              // 예정 버전 (AirMCP)
    replacement?: string;          // 대체 툴/모듈 id
    reason: string;
  };
}

export type ModuleStatus = 'stable' | 'beta' | 'deprecated' | 'broken';

export type Permission =
  | 'automation.Notes'
  | 'automation.Reminders'
  | 'automation.Calendar'
  | 'automation.Mail'
  | 'automation.Messages'
  | 'automation.Safari'
  | 'automation.Music'
  | 'automation.Photos'
  | 'accessibility'
  | 'full-disk-access'
  | 'healthkit'
  | 'location';

export type Hardware =
  | 'apple-silicon'
  | 'neural-engine'
  | 'camera'
  | 'microphone';
```

### 2.2 툴 레벨 호환성

모듈 레벨로 부족한 경우(예: Safari 모듈은 `add_bookmark`만 깨지고 나머지 11개 툴은 정상), 툴 단위 annotation:

```ts
server.registerTool(
  'add_bookmark',
  {
    title: 'Add Bookmark',
    description: 'Add a URL to Safari bookmarks.',
    compatibility: {
      maxMacosVersion: 25,            // macOS 26에서 제거됨
      status: 'deprecated',
      deprecation: {
        since: '2.2.0',
        removeAt: '3.0.0',
        replacement: 'add_to_reading_list',
        reason: 'Safari removed bookmark scripting in macOS 26',
      },
    },
    // …
  },
  handler,
);
```

`ToolCompatibility` 인터페이스는 `src/shared/compatibility.ts`(신규)에 정의.

### 2.3 시작 시 동작 (Runtime Filter)

```ts
// src/server/mcp-setup.ts (pseudocode)
for (const m of MANIFEST) {
  const verdict = evaluateCompatibility(m, hostEnv);
  switch (verdict.decision) {
    case 'register':
      await loadAndRegister(m);
      break;
    case 'skip-unsupported':
      logInfo(`Skipping module ${m.id}: requires macOS ${m.minMacosVersion}+`);
      reportedModules.push({ id: m.id, status: 'skipped', reason: verdict.reason });
      break;
    case 'skip-broken':
      logWarn(`Skipping module ${m.id}: known broken on macOS ${hostEnv.macosVersion}`);
      reportedModules.push({ id: m.id, status: 'broken', reason: verdict.reason });
      break;
    case 'register-with-deprecation':
      await loadAndRegister(m);
      logWarn(`Module ${m.id} is deprecated since ${m.deprecation.since}, removal at ${m.deprecation.removeAt}`);
      break;
  }
}
```

**툴 레벨**도 동일한 흐름을 `toolRegistry.installOn()` 직전에 적용. deprecated 툴은 `errDeprecated`(RFC 0001) 헬퍼로 이미 생성한 분류 활용.

### 2.4 에이전트·클라이언트 가시성

1. **`discover_tools` 응답 확장** — 각 툴에 `compatibility` 요약 필드:
   ```json
   {
     "name": "add_bookmark",
     "status": "deprecated",
     "replacement": "add_to_reading_list",
     "supportedMacos": "<=25"
   }
   ```
2. **`.well-known/mcp.json`** — `compatibility.macos` 블록:
   ```json
   {
     "compatibility": {
       "macos": { "min": 14, "tested": [14, 15, 26.0, 26.1] },
       "skippedModules": ["podcasts"],
       "deprecatedTools": ["add_bookmark"]
     }
   }
   ```
3. **`airmcp doctor`** — "이 호스트에서 비활성화된 모듈/툴" 섹션 렌더.

### 2.5 대상 모듈·툴 Wave 1 체크리스트

RFC 채택 즉시 다음 항목을 manifest에 반영:

| 모듈/툴 | 제안 상태 | 근거 |
|---|---|---|
| `intelligence` (모듈) | `minMacosVersion: 26`, `status: beta` | 이미 gated, 현 동작 유지 |
| `safari.add_bookmark` (툴) | `maxMacosVersion: 25`, `deprecation: { removeAt: 3.0.0 }` | macOS 26에서 JXA dictionary 제거 |
| `podcasts` (모듈) | `status: broken`, `brokenOn: [26.0, 26.1]`, `deprecation: { removeAt: 3.0.0 }` | 현재 코드 상 “등록+런타임 실패”를 명시화 |
| `health` (모듈) | `requiresPermissions: ['healthkit']`, `requiresHardware: ['apple-silicon']` | Swift 브리지 Apple Silicon 의존 |
| `location` (모듈) | `requiresPermissions: ['location']` | CLLocationManager |
| `generate_image`·`scan_document` | `minMacosVersion: 26` | Apple Vision/ImageCreator |

---

## 3. Migration Plan

| 단계 | 작업 | 버전 | 호환성 |
|---|---|---|---|
| 1 | `ModuleManifest`·`ToolCompatibility` 타입 정의 | v2.8.0 | ✅ |
| 2 | `src/shared/compatibility.ts` 구현 (`evaluateCompatibility`, OS 감지, 권한 체크 스텁) | v2.8.0 | ✅ |
| 3 | Wave 1 모듈·툴(위 표)에 필드 추가 | v2.8.0 | ✅ (툴 등록 여부만 바뀜) |
| 4 | `discover_tools`·`.well-known/mcp.json`·`doctor` 통합 | v2.8.0 | 선택 필드라 ✅ |
| 5 | 나머지 25개 모듈에도 `requiresPermissions`·`status` 채우기 | v2.8.1 | ✅ |
| 6 | v3.0.0에서 `add_bookmark`·`podcasts` 실제 제거 (deprecation 기간 종료 후) | v3.0.0 | ⚠️ Breaking (사전 공지 충분) |

**Breaking 여부**:
- v2.8.0에서는 비파괴. 일부 모듈이 로드 스킵되지만, 그 모듈은 애초에 런타임에 항상 실패하던 것이어서 실질적 기능 변화 없음.
- v3.0.0에서 실제 제거될 때 CHANGELOG `Removed` + Release Notes BREAKING 라벨.

---

## 4. Alternatives Considered

### 4.1 `process.env.AIRMCP_DISABLE_<MODULE>` 로 수동 스킵
- 현재 이미 존재. 문제는 "잘못된 호환성을 사용자가 외워야 한다"는 점. 자동 감지가 옳다.

### 4.2 `try { import(m) } catch { skip }` 스타일
- v2.2.0에서 이미 try-catch로 감싼다. 그러나 "import은 성공하지만 런타임에만 실패"하는 경우(JXA dictionary 부재) 감지 불가.

### 4.3 Swift 바이너리에 모든 호환성 판단 위임
- Swift Foundation의 OS 버전 API는 신뢰할 수 있지만, 모든 호환성(권한·하드웨어)까지 Swift로 넘기면 startup 비용이 증가. 분업: OS 버전은 Swift, 권한/하드웨어는 per-module 스텁.

### 4.4 OpenSSF Metadata standard 등 외부 스키마 채택
- 현재 macOS-specific 정보를 담는 표준 없음. 자체 스키마가 최소 비용.

---

## 5. Open Questions

1. **macOS 버전 비교 단위**: major(14/15/26)만인가, minor(26.0/26.1)까지인가? 대부분은 major로 충분하지만 Podcasts JXA 처럼 point release에서 회귀가 날 수 있음. 초기엔 major + 옵셔널 minor.
2. **권한 사전 체크**: 시작 시 권한 조회는 macOS 프롬프트를 유발할 수 있다. 제안: **조회만**(프롬프트 없이 현재 상태 읽기), 미허용 시 경고하되 등록 여부는 영향 주지 않음. 실제 툴 호출 시 `errPermission`(RFC 0001).
3. **하드웨어 조건**: `neural-engine`은 Apple Silicon 일반 기준. 더 세분화(M1/M2/M3/M4)는 **당장 불필요**.
4. **discover_tools 응답 커짐**: 262 툴 × 새 필드는 응답 용량에 영향. 실측 후 `compact=true` 플래그로 기존 형태 유지 옵션 제공.
5. **TypeScript 타입 엄격성**: manifest가 유니온 타입 많아져 any 증가 가능. 제네릭 신중히.

---

## 6. Success Metrics

- "항상 실패하는 툴"이 에이전트에 노출되는 경우 0건 (Podcasts·add_bookmark 스킵/deprecate 상태)
- `airmcp doctor`가 비활성 모듈/툴 목록을 **모든 macOS 26 호스트**에서 정확히 보여줌
- 외부 기여자가 새 툴을 추가할 때 "compatibility 필드를 채우세요" 가이드(CONTRIBUTING.md)가 있으면 PR 리뷰 왕복 감소
- v3.0.0 Breaking 제거 시점에 사용자 이슈 스파이크 없음 (deprecation 기간 + 경고 통해 사전 인지)

---

## 7. Next Steps

1. 본 RFC 리뷰·승인
2. `src/shared/compatibility.ts` + 타입 정의 PR
3. Wave 1 모듈·툴 manifest 확장 PR (`intelligence`·`safari.add_bookmark`·`podcasts` 포함)
4. `discover_tools`·`doctor` 통합 PR
5. CONTRIBUTING.md에 "호환성 필드 가이드" 섹션 추가
6. v3.0.0 BREAKING CHANGES 문서에 `add_bookmark`·`podcasts` 제거 예고 등재
