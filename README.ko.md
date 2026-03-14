# AirMCP

Apple 생태계 전체를 위한 MCP 서버 — Notes, Reminders, Calendar, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Apple Intelligence, TV, Screen Capture, Maps, Podcasts. AI를 Mac에 연결합니다.

> [English](README.md)

## 특징

- **170+ 도구** (18개 모듈) — Apple 앱 CRUD + 시스템 제어 + Apple Intelligence + UI Automation + 스크린 캡처 + 지도 + 팟캐스트 + 동적 단축어
- **23개 프롬프트** — 앱별 워크플로우 + 크로스 모듈 + 개발자 워크플로우 (dev-session, debug-loop, build-log)
- **11개 MCP 리소스** — Notes, Calendar, Reminders 실시간 데이터 URI
- **JXA + Swift 브릿지** — JXA로 기본 자동화, EventKit/PhotoKit으로 고급 기능
- **반복 이벤트/리마인더** — EventKit으로 반복 규칙 생성 (macOS 26+ Swift 브릿지)
- **사진 가져오기/삭제** — PhotoKit으로 사진 관리 (macOS 26+ Swift 브릿지)
- **Apple Intelligence** — 온디바이스 요약, 재작성, 교정 (macOS 26+)
- **네이티브 메뉴바 앱** — SwiftUI 컴패니언 앱 (온보딩 위자드, 자동 시작, 로그 뷰어, 업데이트 알림, 권한 설정)
- **원클릭 셋업** — `setup_permissions` 도구 또는 메뉴바 앱으로 모든 macOS 권한을 한번에 요청
- **듀얼 전송** — stdio (기본, 안전한 로컬 통신) + HTTP/SSE (`--http`) 원격 에이전트 및 레지스트리 지원
- **Safety Annotations** — 모든 도구에 readOnly/destructive 힌트 적용

## 빠른 시작

모든 MCP 호환 클라이언트에서 사용 가능합니다.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add airmcp -- npx -y airmcp
```

### Cursor

`.cursor/mcp.json`에 추가:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`에 추가:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### 기타 MCP 클라이언트

MCP stdio 전송을 지원하는 모든 클라이언트에서 사용 가능. 서버 명령어: `npx -y airmcp`

### 로컬 개발

```bash
git clone https://github.com/heznpc/iConnect.git
cd iConnect
npm install
npm run build
```

### 메뉴바 앱 (선택)

서버 상태 모니터링과 권한 설정을 위한 네이티브 SwiftUI 컴패니언 앱.

```bash
cd app && swift build -c release
# 바이너리: app/.build/release/AirMCPApp
```

기능: 온보딩 위자드, 로그인 시 자동 시작, 로그 뷰어, 업데이트 알림, 서버 상태 표시, 원클릭 권한 설정, MCP 클라이언트 설정 클립보드 복사.

### HTTP 모드

원격 에이전트, Smithery 레지스트리, 멀티 클라이언트를 위한 HTTP 서버 모드:

```bash
npx airmcp --http --port 3847
```

- 엔드포인트: `POST/GET/DELETE /mcp`
- 전송: Streamable HTTP + SSE (MCP 스펙 2024-11-05)
- `Mcp-Session-Id` 헤더로 세션 관리
- 기본 포트: 3847

Mac Mini를 "상시 가동 AI 허브"로 활용할 때 유용합니다.

## 도구

### Notes (12개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_notes` | 메모 목록 (제목, 폴더, 날짜) | 읽기 |
| `search_notes` | 키워드 검색 | 읽기 |
| `read_note` | 전체 내용 조회 | 읽기 |
| `create_note` | HTML 본문으로 생성 | 쓰기 |
| `update_note` | 본문 전체 교체 | 파괴적 |
| `delete_note` | 삭제 (최근 삭제로 이동) | 파괴적 |
| `move_note` | 다른 폴더로 이동 | 파괴적 |
| `list_folders` | 폴더 목록 | 읽기 |
| `create_folder` | 폴더 생성 | 쓰기 |
| `scan_notes` | 일괄 스캔 (미리보기 포함) | 읽기 |
| `compare_notes` | 2~5개 메모 비교 | 읽기 |
| `bulk_move_notes` | 여러 메모 일괄 이동 | 파괴적 |

### Reminders (11개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_reminder_lists` | 리스트 목록 | 읽기 |
| `list_reminders` | 리마인더 조회 (필터) | 읽기 |
| `read_reminder` | 상세 조회 | 읽기 |
| `create_reminder` | 생성 (마감일/우선순위) | 쓰기 |
| `update_reminder` | 속성 변경 | 파괴적 |
| `complete_reminder` | 완료/미완료 처리 | 쓰기 |
| `delete_reminder` | 영구 삭제 | 파괴적 |
| `search_reminders` | 이름/본문 키워드 검색 | 읽기 |
| `create_reminder_list` | 새 리스트 생성 | 쓰기 |
| `delete_reminder_list` | 리스트 삭제 | 파괴적 |
| `create_recurring_reminder` | 반복 규칙으로 생성 (Swift/EventKit) | 쓰기 |

### Calendar (10개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_calendars` | 캘린더 목록 | 읽기 |
| `list_events` | 날짜 범위 이벤트 조회 | 읽기 |
| `read_event` | 이벤트 상세 (참석자 포함) | 읽기 |
| `create_event` | 이벤트 생성 | 쓰기 |
| `update_event` | 이벤트 수정 | 파괴적 |
| `delete_event` | 이벤트 삭제 | 파괴적 |
| `search_events` | 키워드 검색 | 읽기 |
| `get_upcoming_events` | 지금부터 다음 N개 이벤트 | 읽기 |
| `today_events` | 오늘 일정 전체 | 읽기 |
| `create_recurring_event` | 반복 규칙으로 이벤트 생성 (Swift/EventKit) | 쓰기 |

### Contacts (10개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_contacts` | 연락처 목록 (페이지네이션) | 읽기 |
| `search_contacts` | 이름/이메일/전화/조직 검색 | 읽기 |
| `read_contact` | 상세 조회 (이메일, 전화, 주소) | 읽기 |
| `create_contact` | 연락처 생성 | 쓰기 |
| `update_contact` | 속성 변경 | 파괴적 |
| `delete_contact` | 영구 삭제 | 파괴적 |
| `list_groups` | 그룹 목록 | 읽기 |
| `add_contact_email` | 기존 연락처에 이메일 추가 | 쓰기 |
| `add_contact_phone` | 기존 연락처에 전화번호 추가 | 쓰기 |
| `list_group_members` | 그룹 내 연락처 목록 | 읽기 |

### Mail (11개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_mailboxes` | 메일함 목록 (미읽음 수) | 읽기 |
| `list_messages` | 메일함 내 메시지 목록 | 읽기 |
| `read_message` | 메시지 전체 내용 | 읽기 |
| `search_messages` | 제목/발신자 검색 | 읽기 |
| `mark_message_read` | 읽음/안읽음 처리 | 쓰기 |
| `flag_message` | 깃발 표시/해제 | 쓰기 |
| `get_unread_count` | 전체 메일함 미읽음 수 | 읽기 |
| `move_message` | 다른 메일함으로 이동 | 파괴적 |
| `list_accounts` | 메일 계정 목록 | 읽기 |
| `send_mail` | 이메일 작성 및 전송 | 쓰기 |
| `reply_mail` | 이메일 답장 | 쓰기 |

### Music (9개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_playlists` | 재생목록 목록 | 읽기 |
| `list_tracks` | 재생목록 내 트랙 | 읽기 |
| `now_playing` | 현재 재생 중인 트랙 | 읽기 |
| `playback_control` | 재생/일시정지/다음/이전 | 쓰기 |
| `search_tracks` | 이름/아티스트/앨범 검색 | 읽기 |
| `play_track` | 이름으로 특정 트랙 재생 | 쓰기 |
| `play_playlist` | 재생목록 재생 시작 | 쓰기 |
| `get_track_info` | 트랙 상세 메타데이터 | 읽기 |
| `set_shuffle` | 셔플/반복 모드 설정 | 쓰기 |

### Finder (8개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `search_files` | Spotlight 파일 검색 | 읽기 |
| `get_file_info` | 파일 정보 (크기, 날짜, 태그) | 읽기 |
| `set_file_tags` | Finder 태그 설정 | 파괴적 |
| `recent_files` | 최근 수정 파일 | 읽기 |
| `list_directory` | 디렉토리 내 파일 목록 | 읽기 |
| `move_file` | 파일 이동/이름 변경 | 파괴적 |
| `trash_file` | 휴지통으로 이동 | 파괴적 |
| `create_directory` | 새 디렉토리 생성 | 쓰기 |

### Safari (8개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_tabs` | 전체 윈도우의 탭 목록 | 읽기 |
| `read_page_content` | 페이지 텍스트 내용 읽기 | 읽기 |
| `get_current_tab` | 현재 활성 탭 URL/제목 | 읽기 |
| `open_url` | Safari에서 URL 열기 | 쓰기 |
| `close_tab` | 특정 탭 닫기 | 파괴적 |
| `activate_tab` | 특정 탭으로 전환 | 쓰기 |
| `run_javascript` | 탭에서 JavaScript 실행 | 쓰기 |
| `search_tabs` | 제목/URL로 탭 검색 | 읽기 |

### System (10개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `get_clipboard` | 클립보드 내용 읽기 | 읽기 |
| `set_clipboard` | 클립보드에 쓰기 | 쓰기 |
| `get_volume` | 시스템 볼륨 확인 | 읽기 |
| `set_volume` | 시스템 볼륨 설정 | 쓰기 |
| `toggle_dark_mode` | 다크/라이트 모드 전환 | 쓰기 |
| `get_frontmost_app` | 최전면 앱 확인 | 읽기 |
| `list_running_apps` | 실행 중인 앱 목록 | 읽기 |
| `get_screen_info` | 디스플레이 정보 | 읽기 |
| `show_notification` | 시스템 알림 표시 | 쓰기 |
| `capture_screenshot` | 스크린샷 캡처 (전체/윈도우/선택) | 쓰기 |

### Photos (9개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_albums` | 앨범 목록 | 읽기 |
| `list_photos` | 앨범 내 사진 목록 | 읽기 |
| `search_photos` | 키워드로 사진 검색 | 읽기 |
| `get_photo_info` | 사진 상세 메타데이터 | 읽기 |
| `list_favorites` | 즐겨찾기 사진 목록 | 읽기 |
| `create_album` | 새 앨범 생성 | 쓰기 |
| `add_to_album` | 앨범에 사진 추가 | 쓰기 |
| `import_photo` | 파일에서 사진 가져오기 (Swift/PhotoKit) | 쓰기 |
| `delete_photos` | ID로 사진 삭제 (Swift/PhotoKit) | 파괴적 |

### Messages (6개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_chats` | 최근 대화 목록 (참여자 포함) | 읽기 |
| `read_chat` | 대화 상세 조회 (참여자, 마지막 업데이트 포함) | 읽기 |
| `search_chats` | 이름/참여자/핸들로 검색 | 읽기 |
| `send_message` | iMessage/SMS 텍스트 전송 | 쓰기 |
| `send_file` | iMessage/SMS 파일 첨부 전송 | 쓰기 |
| `list_participants` | 대화 참여자 목록 | 읽기 |

### Shortcuts (10개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `list_shortcuts` | 사용 가능한 단축어 목록 | 읽기 |
| `run_shortcut` | 이름으로 단축어 실행 | 쓰기 |
| `search_shortcuts` | 이름으로 단축어 검색 | 읽기 |
| `get_shortcut_detail` | 단축어 상세 정보/액션 | 읽기 |
| `create_shortcut` | UI 자동화로 새 단축어 생성 | 쓰기 |
| `delete_shortcut` | 이름으로 단축어 삭제 (macOS 13+) | 파괴적 |
| `export_shortcut` | .shortcut 파일로 단축어 내보내기 | 쓰기 |
| `import_shortcut` | .shortcut 파일에서 단축어 가져오기 | 쓰기 |
| `edit_shortcut` | Shortcuts 앱에서 단축어 편집 열기 | 쓰기 |
| `duplicate_shortcut` | 기존 단축어 복제 | 쓰기 |

### UI Automation (6개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `ui_open_app` | 앱 열기 + 접근성 요약 읽기 | 읽기 |
| `ui_click` | 좌표 또는 텍스트로 요소 클릭 | 쓰기 |
| `ui_type` | 포커스된 필드에 텍스트 입력 | 쓰기 |
| `ui_press_key` | 키 조합 전송 | 쓰기 |
| `ui_scroll` | 방향 스크롤 | 쓰기 |
| `ui_read` | 앱 접근성 트리 읽기 | 읽기 |

### Apple Intelligence (8개)

macOS 26+ Apple Silicon 필요.

| 도구 | 설명 | 타입 |
|------|------|------|
| `summarize_text` | 온디바이스 텍스트 요약 | 읽기 |
| `rewrite_text` | 톤 지정 재작성 | 읽기 |
| `proofread_text` | 문법/맞춤법 교정 | 읽기 |
| `generate_text` | 온디바이스 AI로 커스텀 텍스트 생성 | 읽기 |
| `generate_structured` | 스키마 기반 구조화 JSON 출력 | 읽기 |
| `tag_content` | 콘텐츠 태깅/분류 (신뢰도 포함) | 읽기 |
| `ai_chat` | 이름 기반 멀티턴 온디바이스 AI 세션 | 읽기 |
| `ai_status` | Foundation Model 가용성 확인 | 읽기 |

### TV (6개)

| 도구 | 설명 | 타입 |
|------|------|------|
| `tv_list_playlists` | Apple TV 재생목록 (라이브러리) 목록 | 읽기 |
| `tv_list_tracks` | 재생목록 내 영화/에피소드 목록 | 읽기 |
| `tv_now_playing` | 현재 재생 중인 콘텐츠 | 읽기 |
| `tv_playback_control` | 재생/일시정지/다음/이전 제어 | 쓰기 |
| `tv_search` | 영화/TV 프로그램 검색 | 읽기 |
| `tv_play` | 이름으로 영화/에피소드 재생 | 쓰기 |

### 스크린 캡처 (4개 도구)

| 도구 | 설명 | 유형 |
|------|------|------|
| `capture_screen` | 전체 화면 스크린샷 캡처 (PNG 이미지 반환) | 읽기 |
| `capture_window` | 특정 앱 윈도우 캡처 | 읽기 |
| `capture_area` | 좌표로 화면 영역 캡처 | 읽기 |
| `list_windows` | 모든 윈도우 목록 (위치/크기 포함) | 읽기 |

### 지도 (6개 도구)

| 도구 | 설명 | 유형 |
|------|------|------|
| `search_location` | Apple 지도에서 장소 검색 | 쓰기 |
| `get_directions` | 두 위치 간 경로 안내 | 쓰기 |
| `drop_pin` | 특정 좌표에 핀 표시 | 쓰기 |
| `open_address` | 특정 주소를 Apple 지도에서 열기 | 쓰기 |
| `search_nearby` | 주변 장소 검색 | 쓰기 |
| `share_location` | 공유 가능한 Apple 지도 링크 생성 | 읽기 |

## 리소스

MCP 리소스는 Apple 앱의 실시간 데이터를 URI로 제공합니다.

| URI | 설명 |
|-----|------|
| `notes://recent` | 최근 메모 10개 |
| `notes://recent/{count}` | 최근 메모 (개수 지정, 최대 50) |
| `calendar://today` | 오늘의 캘린더 이벤트 |
| `calendar://upcoming` | 향후 7일 캘린더 이벤트 |
| `reminders://due` | 기한 지난 리마인더 |
| `reminders://today` | 오늘 마감 리마인더 (미완료만) |
| `music://now-playing` | Apple Music 현재 재생 중인 트랙 |
| `system://clipboard` | macOS 클립보드 내용 |
| `mail://unread` | 전체 메일함 읽지 않은 메일 수 |
| `context://snapshot` | 모든 활성 앱의 통합 컨텍스트 |
| `context://snapshot/{depth}` | 깊이 설정 가능한 통합 컨텍스트 (brief/standard/full) |

## 프롬프트

### 앱별
- **organize-notes** — 메모 분류, 폴더 생성, 이동
- **find-duplicates** — 중복 메모 찾기, 비교, 정리
- **weekly-review** — 주간 메모 요약
- **organize-reminders** — 리마인더 정리
- **daily-review** — 오늘 마감 리마인더 리뷰
- **schedule-review** — 향후 일정 리뷰, 충돌 확인
- **meeting-prep** — 미팅 준비 (이벤트 + 관련 메모)

### 크로스 모듈
- **daily-briefing** — 오늘 일정 + 마감 리마인더 + 최근 메모 종합
- **weekly-digest** — N일간 이벤트 + 메모 + 리마인더 종합 리뷰
- **meeting-notes-to-reminders** — 미팅 메모에서 할 일 추출 → 리마인더 생성
- **event-follow-up** — 미팅 후 팔로업 노트 + 리마인더 생성
- **research-with-safari** — Safari로 조사 + Notes에 결과 저장
- **focus-session** — Calendar + Reminders + Music으로 집중 세션
- **file-organizer** — Finder로 파일 정리 + Notes에 기록

### 개발자 워크플로우
- **dev-session** — 프로젝트 스캔, 스펙 확인, 문서 리서치, 세션 노트 생성
- **debug-loop** — Safari/클립보드에서 에러 캡처, 코드 위치 특정, 버그 로그, Fix 태스크 생성
- **screen-capture-flow** — 스크린샷 → Photos 가져오기 → 주석 노트 생성
- **app-release-prep** — 캘린더 일정 + Notes 체인지로그 + Reminders 체크리스트
- **idea-to-task** — 아이디어 → 태스크 분해 → Reminders + Calendar 타임 블록
- **build-log** — 빌드 결과 분석, 에러 로그 또는 Music으로 성공 축하

### Shortcuts
- **shortcut-automation** — Siri Shortcuts 체이닝으로 자동화 구성
- **shortcut-discovery** — 작업에 맞는 단축어 탐색
- **shortcut-troubleshooting** — 단축어 디버깅 및 수정

## Developer Agent Pipeline

AirMCP의 개발자 프롬프트는 Apple 앱들을 자율 에이전트 워크플로우로 연결합니다. 각 프롬프트는 여러 모듈의 도구를 오케스트레이션하여 — AI가 실제 파일시스템, Notes, Calendar, Reminders를 읽어 컨텍스트를 구성하고, 구조화된 결과를 기록합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     dev-session                                 │
│  Finder (스캔) → Notes (스펙) → Safari (문서) → Notes (로그)      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     debug-loop                                  │
│  Safari (JS 에러) → Clipboard → Finder (위치 특정) →             │
│  Notes (버그 로그) → Reminders (Fix 태스크)                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     idea-to-task                                 │
│  Notes (아이디어) → AI (분해) → Reminders (태스크) →              │
│  Calendar (타임 블록)                                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     build-log                                   │
│  Finder (아웃풋) → Clipboard (로그) →                            │
│  ┌ 실패 → Notes (에러 로그) → Reminders (Fix 태스크)              │
│  └ 성공 → Notification → Music (축하) → Notes (성공 로그)         │
└─────────────────────────────────────────────────────────────────┘
```

AI 코딩 에이전트(Claude Code, Cursor, Copilot)가 MCP 프롬프트로 호출하도록 설계되어 Mac을 컨텍스트 인식 개발 환경으로 전환합니다.

> 데모 영상 준비 중

## 모듈 프리셋

기본 설치 시 5개 핵심 모듈(Notes, Reminders, Calendar, Shortcuts, System)만 활성화됩니다.

```bash
# 설정 위자드로 모듈 변경
npx airmcp init

# 모든 모듈 한번에 활성화
npx airmcp --full
```

또는 `~/.config/airmcp/config.json`을 직접 편집:

```json
{
  "disabledModules": ["messages", "intelligence"]
}
```

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `npx airmcp init` | 대화형 설정 위자드 |
| `npx airmcp doctor` | 설치 문제 진단 |
| `npx airmcp` | MCP 서버 시작 (stdio, 기본) |
| `npx airmcp --full` | 15개 모듈 전체 활성화로 시작 |
| `npx airmcp --http` | HTTP 서버로 시작 (포트 3847) |

## 설정

### 환경 변수

| 환경 변수 | 기본값 | 설명 |
|----------|--------|------|
| `AIRMCP_INCLUDE_SHARED` | `false` | 공유 메모/폴더 포함 |
| `AIRMCP_ALLOW_SEND_MESSAGES` | `true` | iMessage 전송 허용 |
| `AIRMCP_ALLOW_SEND_MAIL` | `true` | 이메일 전송 허용 |
| `AIRMCP_FULL` | `false` | 모든 모듈 활성화 (프리셋 무시) |
| `AIRMCP_DISABLE_{MODULE}` | — | 특정 모듈 비활성화 (예: `AIRMCP_DISABLE_MUSIC=true`) |
| `GEMINI_API_KEY` | — | Google Gemini 임베딩용 API 키 (선택) |

### 설정 파일

`~/.config/airmcp/config.json`:

```json
{
  "disabledModules": ["messages", "intelligence"],
  "includeShared": false,
  "allowSendMessages": true,
  "allowSendMail": true,
  "hitl": {
    "level": "destructive-only",
    "timeout": 30
  }
}
```

### Human-in-the-Loop (HITL)

파괴적 작업 전에 수동 승인을 요구합니다:

```json
{
  "hitl": {
    "level": "destructive-only",
    "timeout": 30
  }
}
```

레벨: `off`, `destructive-only`, `all-writes`, `all`

## 요구 사항

- macOS
- Node.js >= 18
- 각 앱 자동화 권한 (첫 실행 시 요청) — `setup_permissions` 도구로 한번에 설정 가능
- Apple Intelligence: macOS 26+ Apple Silicon

## 제한 사항

OS 요구 사항이 있는 모듈(예: Intelligence는 macOS 26+ 필요)은 런타임 OS 감지를 통해 이전 시스템에서 자동으로 비활성화됩니다.

### Notes
- 이동 시 복사 후 삭제 (새 ID, 날짜 초기화, 첨부 파일 유실)
- 업데이트는 본문 전체를 교체합니다. 내용 보존을 위해 먼저 읽기
- 비밀번호 보호된 메모 읽기 불가

### Reminders / Calendar
- JXA 반복 규칙은 읽기 전용 — `create_recurring_event`/`create_recurring_reminder` (Swift/EventKit) 사용
- 캘린더 참석자 읽기 전용

### Contacts
- 사용자 지정 필드 접근 불가

### Mail
- 내용 기본 5000자 제한 (`maxLength` 파라미터로 조절 가능)

### Messages
- 개별 메시지 내용(대화 기록)은 JXA로 접근 불가
- 전송 시 수신자가 Messages 서비스에 등록된 buddy여야 함

### Music
- 스마트 재생목록 읽기 전용
- 대기열 조작 불가

### Finder
- 태그는 Spotlight (mdfind) 사용, 인덱스 상태에 따라 성능 변동

### Safari
- 페이지 내용 읽기에는 Safari 개발자 메뉴에서 Apple 이벤트의 JavaScript 허용 필요

### Photos
- JXA: 앨범 생성 및 사진 추가 가능, 가져오기/삭제 불가
- Swift 브릿지 (macOS 26+): PhotoKit으로 가져오기/삭제 가능

### Apple Intelligence
- macOS 26 (Tahoe) + Apple Silicon 필요
- `npm run swift-build`로 브릿지 바이너리 빌드

## 라이선스

MIT
