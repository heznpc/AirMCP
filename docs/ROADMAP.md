# AirMCP Roadmap

> **2026-04-30 기준 (v2.11.0+).** 269 tools / 29 modules. 4주 우선순위 + 분기 단위 전망.
>
> 내부 스크래치 / 백로그는 루트의 `TODO.md` (gitignored, 개인용). 머지된 항목은 [CHANGELOG.md](../CHANGELOG.md).

## 4주 우선순위 (2026-05)

### P0 — 데이터 무결성 / 보안

1. **`bulk_move_notes` 비원자성 정리** — `dryRun` 옵션 + per-iteration stop + 메타 보존 시도. 실측 위협은 데이터 손실보다 메타 손실 + 부분-완료 mixed state.
2. **`audit.ts` HMAC chain 도입** — 한 줄 수정/삭제 검출. `auditDisabled` 영구 latch 자동 복구.
3. **iOS Keychain 토큰 영속화** — 매 부팅 토큰 재생성 = 페어링 깨짐. (C) "Apple-native deeper, two devices" 약속의 전제조건.

### P0 — 외부 신뢰도

4. **Tool count drift 잔존 정리** — `gen-llms-txt.mjs`와 `count-stats.mjs` 카운팅 일치 (현재 32 mod / 265 tools vs 29 / 269 canonical).
5. **Registry 12 directory 추가 제출** — 현재 7개 추적. cursor.directory / MCP.so / mcphub.io / awesome-mcp-servers 등 12개 추가.
6. **Anthropic MCP Registry 재제출** — 33일째 pending. v2.11 + `.mcpb` + OAuth + 229 AppIntents pitch.

### P1 — 단기 (5월 내)

7. iOS `.xcodeproj` 추가 + 첫 TestFlight 빌드 (App Store critical path).
8. memory store atomic write + mutex + reviver — partial-write / race / prototype pollution.
9. AppIntent handler injection race fix (`Task.detached` → MainActor `Task`).
10. iOS 26.4 axis 6 (`AskAirMCPIntent`) 골든 재실행 — Apple FoundationModels 모델 OS 업데이트 시 교체.
11. Swift→Node loop-back transport 설계 — `ai_agent` write 도구 노출 재개 위한 토대 (현재는 read-only로 격하 상태).
12. JXA 에러 envelope 업그레이드 — RFC 0001 Wave-final.
13. SpeechAnalyzer 마이그레이션 — `transcribe_audio` 백엔드 ~55% 빠름 + streaming.
14. Swift 6.3 + Xcode 26.4.1 업그레이드 — 코드젠 `compiler(>=6.3)` 가드 가정 가능.

## 분기 단위 (Q3 — 6~8월)

- macOS 26.4 신기능 노출 (Reminders `urgent`, Music `generate_playlist_from_prompt`, System `set_charge_limit`, Liquid Glass UI 정합).
- AppIntents 카탈로그 통합 + Spotlight entity 등록.
- `requestConfirmation` 신규 오버로드 (snippet content / showDialogAsPrompt) — RFC 0007 §A.3.1.
- HITL batch / trust learning / dry-run.
- Skills DSL `cron` trigger.
- CloudKit private DB multi-device sync.
- `ai_plan_metrics` CI 자동화 (weekly).
- SEP-1686 Tasks (long-running progress) — `semantic_index` / `record_screen`.
- MCP spec 2026-06 대응 (well-known schema_version 채널).

## 장기 / 전략 (v3.0+)

- Windows-Apple 브릿지 (조건부 — 시장 검증 후) — `src/win-bridge/` 모듈, `compatibility.platform: "windows-bridge"` 메타.
- CarPlay AirMCP 노출 (3rd-party chatbots in CarPlay).
- 음성 endpoint (실시간 STT → MCP).
- DPoP (SEP-1932) / Workload Identity (SEP-1933) — RFC 0005 Step 4-5.
- `AIRMCP_HTTP_TOKEN` deprecation → 제거 (v2.13 / v3.0).

## 외부 환경 가정 (이 로드맵의 베팅)

| 동향 | AirMCP 영향 | 베팅 |
|------|----------|------|
| **iOS 26.4 / 26.5** (3-24/4-27) — FoundationModels instruction-following + tool-calling 개선 | 모델 OS-업데이트 시 교체 → axis 6 재검증 필요 | Phase A 재테스트 |
| **WWDC 2026 (6/8) — Apple 공식 MCP 발표 가능성** | 카테고리 흡수 위협 + AppIntents-shim 모드 기회 | 6월 전 입장 결정 (RFC) |
| **MCP spec 2026-06 개정** | well-known schema_version 채널 자동 갱신 | forward-compat 유지 |
| **AAIF 거버넌스 (Linux Foundation)** | Anthropic 단독 의사결정 종료, Registry GA | 재제출 |
| **Opus 4.7 / GPT-5.5 / Gemini 3.1** MCP 채택 | 클라이언트 다양성 자동 보장 | 호환 유지, 별도 작업 없음 |

## 폐기 / 완료

- v2.10-v2.11 사이클이 4월 진단 부채 거의 전량 흡수. 잔여 항목은 위 P1/P2에 통합됨.
- 다른 세션의 "P0-2 ai_agent write bypass"는 **검증 후 본 사이클에서 fix** — `FoundationModelsBridge.allTools()` write 도구 2종 제거, ai_agent를 read-only로 격하. v2.12+에서 loop-back transport 설계 후 write 재개 가능.
