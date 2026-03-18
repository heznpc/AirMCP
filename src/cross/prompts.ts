import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";

import { userPrompt } from "../shared/prompt.js";

export function registerCrossPrompts(server: McpServer): void {
  server.prompt(
    "meeting-notes-to-reminders",
    { eventId: z.string().describe("Calendar event ID to extract action items from") },
    ({ eventId }) => {
      return userPrompt(
        "Extract action items from meeting notes and create reminders.",
        `미팅 메모에서 할 일을 추출해서 리마인더로 만들어줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. read_event(id: "${eventId}")로 이벤트 정보를 확인해
2. search_notes로 이벤트 제목/참석자 관련 메모를 검색해
3. 찾은 메모를 read_note로 전체 내용을 읽어
4. 메모 내용에서 할 일(action item)을 추출해:
   - "~해야 함", "TODO", "follow up", "확인 필요" 등의 패턴
   - 담당자가 명시된 항목
   - 기한이 언급된 항목
5. 추출한 항목을 나에게 보여주고 확인을 받아
6. 확인 후 create_reminder로 각 항목을 리마인더로 생성해:
   - 제목: 할 일 내용
   - body: 원본 메모 참조
   - dueDate: 언급된 기한 (없으면 이벤트 다음 날)

중요: 삭제/수정 전에 반드시 확인을 받아.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: read_event 실패 시 search_events로 이벤트 검색)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "weekly-digest",
    { days: z.number().int().min(1).max(30).optional().describe("Days to review (default: 7)") },
    ({ days }) => {
      const n = days ?? 7;
      const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
      const until = new Date().toISOString();
      return userPrompt(
        `Digest of the past ${n} days: notes, events, and reminders combined.`,
        `지난 ${n}일간의 Apple 생태계 전체 요약을 해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **캘린더**: list_events(startDate: "${since}", endDate: "${until}")로 지난 이벤트 조회
2. **메모**: scan_notes로 메모를 스캔하고 ${since} 이후 생성/수정된 것만 필터링
3. **리마인더**: list_reminders(completed: true)로 완료된 리마인더 + list_reminders(completed: false)로 미완료 조회
4. 종합 분석:
   - 이번 주 주요 이벤트/미팅 요약
   - 새로 작성된 메모 주제 분류
   - 완료한 리마인더 성과
   - 아직 미완료인 리마인더 현황
   - 기한 지난(overdue) 항목 경고
5. 다음 주 제안:
   - 정리가 필요한 메모
   - 일정 조정 제안
   - 우선 처리할 리마인더

중요: 실제 AirMCP 도구를 사용해서 Apple Notes, Calendar, Reminders 데이터를 조회해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_events 실패 시 search_events 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "event-follow-up",
    { eventId: z.string().describe("Calendar event ID") },
    ({ eventId }) => {
      return userPrompt(
        "Create follow-up note and reminders after a meeting.",
        `미팅 후 팔로업을 정리해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. read_event(id: "${eventId}")로 이벤트 정보를 확인해
2. 이벤트 제목, 참석자, 시간을 파악해
3. 나에게 미팅 결과를 물어봐 (주요 논의 사항, 결정 사항, 다음 단계)
4. 내 답변을 기반으로:
   a. create_note로 미팅 노트를 생성해 (제목: "[미팅 노트] {이벤트 제목} - {날짜}")
      - 참석자 목록
      - 주요 논의 사항
      - 결정 사항
      - Action Items
   b. 각 action item을 create_reminder로 생성해
5. 생성된 메모와 리마인더를 확인해줘

중요: 미팅 내용은 나에게 물어보고, 자의적으로 작성하지 마.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: read_event 실패 시 search_events로 이벤트 검색)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "daily-briefing",
    "Comprehensive daily briefing with today's events, due reminders, and recent notes.",
    () => {
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
      const dateStr = today.toISOString().split("T")[0];
      return userPrompt(
        "Daily briefing: today's events, due reminders, and recent notes.",
        `오늘(${dateStr})의 데일리 브리핑을 해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **오늘 일정**: list_events(startDate: "${todayStart}", endDate: "${todayEnd}")
2. **마감 리마인더**: list_reminders(completed: false) → 오늘 마감 + overdue 필터링
3. **최근 메모**: scan_notes로 스캔 → 어제/오늘 수정된 메모 필터링

다음 형식으로 정리해:

📅 **오늘 일정**
- 시간순으로 이벤트 나열
- 빈 시간대 표시

⏰ **마감/긴급**
- 🔴 기한 지남
- 🟡 오늘 마감
- 🟢 내일까지

📝 **최근 메모**
- 어제/오늘 작성/수정된 메모 요약

💡 **오늘의 제안**
- 우선 처리 항목
- 준비가 필요한 미팅

중요: 실제 AirMCP 도구를 사용해서 데이터를 조회해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_reminders 실패 시 search_reminders 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "research-with-safari",
    { topic: z.string().describe("Research topic to investigate") },
    ({ topic }) => {
      return userPrompt(
        "Safari + Notes research workflow: search tabs, read content, compile findings into a note.",
        `"${topic}" 주제로 리서치를 진행해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **Safari 탭 검색**: list_tabs로 현재 열린 Safari 탭 목록을 확인해
2. **관련 탭 읽기**: "${topic}"과 관련된 탭을 찾아서 read_page_content로 페이지 내용을 읽어
3. **기존 메모 검색**: search_notes로 "${topic}" 관련 기존 메모가 있는지 확인해
4. **리서치 노트 작성**: create_note로 리서치 결과를 정리한 노트를 생성해:
   - 제목: "[리서치] ${topic} - {날짜}"
   - 주요 발견 사항 요약
   - 각 소스의 핵심 내용
   - 출처 (Safari 탭 URL 목록)
   - 기존 메모와의 연관성 (있으면)
5. 추가 조사가 필요한 부분이 있으면 알려줘

중요: Safari 탭의 URL을 출처로 반드시 포함해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: read_page_content 실패 시 다른 탭 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "focus-session",
    { duration: z.number().optional().describe("Focus duration in hours (default: 2)") },
    ({ duration }) => {
      const hours = duration ?? 2;
      const now = new Date();
      const endTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
      const nowISO = now.toISOString();
      const endISO = endTime.toISOString();
      return userPrompt(
        `Set up a ${hours}-hour focus session: check calendar, prioritize reminders, manage music.`,
        `${hours}시간 집중 세션을 설정해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **일정 확인**: list_events(startDate: "${nowISO}", endDate: "${endISO}")로 집중 시간 내 일정 확인
2. **리마인더 확인**: list_reminders(completed: false)로 미완료 리마인더 조회
3. **음악 상태**: now_playing으로 현재 재생 중인 음악 확인
4. 분석 결과를 정리해:

⏰ **집중 세션 정보**
- 시작: 지금부터
- 종료: ${hours}시간 후

⚠️ **방해 요소 경고**
- 집중 시간 내 예정된 미팅/이벤트가 있으면 경고
- 미팅 시작 전 알림 시간도 고려

✅ **집중 시간 동안 할 일**
- 마감이 임박한 리마인더 우선 정리
- 중요도/긴급도 기준으로 우선순위 제안

🎵 **음악**
- 현재 재생 상태 안내
- 음악을 틀거나 변경하고 싶으면 playback_control 사용 가능

중요: 집중 시간 내 미팅이 있으면 반드시 경고해줘.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_events 실패 시 today_events 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "file-organizer",
    { directory: z.string().describe("Directory path to organize") },
    ({ directory }) => {
      return userPrompt(
        "Finder + Notes file organization: scan directory, apply tags, and create summary note.",
        `"${directory}" 폴더의 파일을 정리해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **파일 검색**: search_files로 "${directory}" 내 파일 목록을 확인해
2. **파일 정보 확인**: get_file_info로 주요 파일의 상세 정보(크기, 생성일, 수정일 등)를 확인해
3. **정리 규칙 확인**: search_notes로 파일 정리 관련 규칙이나 메모가 있는지 검색해
4. 파일 분석 결과를 보여줘:
   - 파일 유형별 분류 (문서, 이미지, 코드 등)
   - 크기별 정리 (큰 파일 경고)
   - 오래된 파일 목록
   - 중복 가능성이 있는 파일
5. **태그 제안**: set_file_tags로 파일에 태그를 지정할 수 있어:
   - 유형별 태그 (예: "문서", "이미지", "프로젝트")
   - 상태별 태그 (예: "정리 필요", "보관", "삭제 검토")
   - 나에게 태그 적용 확인을 받아
6. **정리 결과 노트**: create_note로 정리 결과를 요약한 노트 생성:
   - 제목: "[파일 정리] ${directory} - {날짜}"
   - 파일 현황 요약
   - 적용한 태그 목록
   - 추가 정리 제안

중요: 파일 삭제/이동은 하지 말고, 태그 적용 전에 반드시 확인을 받아.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: search_files 실패 시 list_directory 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "dev-session",
    { projectPath: z.string().describe("Project directory path") },
    ({ projectPath }) => {
      return userPrompt(
        "Developer session setup: scan project, check specs, research docs, log to notes.",
        `"${projectPath}" 프로젝트로 개발 세션을 시작해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **프로젝트 구조 파악**: list_directory("${projectPath}")로 프로젝트 루트 확인
   - search_files로 주요 파일 패턴 검색 (package.json, Makefile, README 등)
   - get_file_info로 최근 수정된 파일 확인
   - recent_files("${projectPath}", days: 1)로 오늘 작업한 파일 추적

2. **스펙/컨텍스트 확인**: search_notes로 프로젝트 관련 메모 검색
   - 프로젝트명, 주요 키워드로 검색
   - 찾은 메모가 있으면 read_note로 전체 내용 확인

3. **참고 자료 수집**: list_tabs로 Safari에 열린 관련 탭 확인
   - 관련 문서가 있으면 read_page_content로 핵심 내용 추출

4. **관련 리마인더 확인**: search_reminders로 프로젝트 관련 할 일 조회
   - get_upcoming_events로 관련 미팅/데드라인 확인

5. **세션 노트 생성**: create_note로 개발 세션 노트를 생성해:
   - 제목: "[Dev] ${projectPath.split("/").pop()} - {날짜 시간}"
   - 프로젝트 구조 요약
   - 오늘 작업할 내용
   - 관련 메모/리마인더 링크
   - 참고 URL 목록

6. 컨텍스트 요약을 나에게 브리핑해줘:
   - 프로젝트 현재 상태
   - 오늘의 할 일 우선순위
   - 주의할 사항

중요: 실제 파일시스템과 Apple 앱 데이터를 조회해서 정확한 컨텍스트를 구성해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: search_files 실패 시 list_directory 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "debug-loop",
    {
      errorMessage: z.string().optional().describe("Error message or bug description"),
      projectPath: z.string().optional().describe("Project directory path"),
    },
    ({ errorMessage, projectPath }) => {
      const errorCtx = errorMessage ? `\n에러 메시지: "${errorMessage}"` : "";
      const pathCtx = projectPath ? `\n프로젝트 경로: "${projectPath}"` : "";
      return userPrompt(
        "Debug loop: capture errors, locate code, log bugs, create fix tasks.",
        `디버깅 루프를 시작해줘.${errorCtx}${pathCtx}

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **에러 수집**:
   - Safari 탭 확인: list_tabs로 열린 탭 중 localhost/개발 서버 탭 찾기
   - 관련 탭이 있으면 run_javascript로 콘솔 에러 캡처:
     \`JSON.stringify(window.__consoleErrors || 'No captured errors')\`
   - get_clipboard으로 클립보드에 복사된 에러 메시지 확인${projectPath ? `\n   - recent_files("${projectPath}", days: 1)로 최근 수정 파일 확인` : ""}

2. **코드 위치 특정**:${projectPath ? `\n   - search_files("${projectPath}", 에러 관련 키워드)로 관련 파일 검색` : ""}
   - 에러 메시지에서 파일명/라인 번호 추출
   - get_file_info로 해당 파일 정보 확인

3. **버그 로그 기록**: create_note로 버그 리포트 생성:
   - 제목: "[Bug] {에러 요약} - {날짜}"
   - 에러 메시지 전문
   - 재현 경로 (추정)
   - 관련 파일 목록
   - 가능한 원인 분석

4. **Fix 태스크 생성**: create_reminder로 수정 태스크 생성:
   - 제목: "[Fix] {에러 요약}"
   - body: 버그 노트 참조, 수정 방향 제안
   - priority: 에러 심각도에 따라 (1=critical, 5=medium, 9=low)

5. **결과 브리핑**:
   - 발견된 에러 요약
   - 가능한 원인 TOP 3
   - 제안하는 수정 순서
   - 추가 조사가 필요한 부분

중요: 에러 분석은 실제 데이터 기반으로. 추측만으로 판단하지 마.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: search_files 실패 시 list_directory 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "screen-capture-flow",
    {
      description: z.string().optional().describe("What to capture/document"),
    },
    ({ description }) => {
      const desc = description ?? "작업 과정";
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      return userPrompt(
        "Screen capture workflow: screenshot, save to Photos, create note with annotation.",
        `"${desc}" 화면 캡처 플로우를 시작해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **현재 상태 파악**:
   - get_frontmost_app으로 현재 활성 앱 확인
   - get_screen_info로 디스플레이 정보 확인

2. **스크린샷 캡처**: capture_screenshot으로 화면 캡처:
   - path: "/tmp/airmcp-capture-${timestamp}.png"
   - region: "fullscreen" (또는 필요에 따라 "window"/"selection")
   - 필요하면 여러 장 캡처 (다른 앱/화면 전환 후)

3. **Photos에 정리**:
   - 캡처 파일을 import_photo로 Photos 라이브러리에 가져오기
   - create_album으로 "[캡처] ${desc}" 앨범 생성 (없으면)
   - add_to_album으로 캡처한 사진을 앨범에 추가

4. **캡처 메모 작성**: create_note로 캡처 문서 생성:
   - 제목: "[캡처] ${desc} - {날짜}"
   - 캡처 시점의 활성 앱 정보
   - 각 스크린샷 설명
   - 캡처 의도/맥락: "${desc}"
   - 파일 경로 목록

5. **알림**: show_notification으로 캡처 완료 알림

중요: 캡처 전에 준비가 필요하면 나에게 알려줘. 민감한 정보가 포함될 수 있으니 확인 후 진행.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: capture_screenshot 실패 시 capture_window 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "app-release-prep",
    {
      appName: z.string().describe("Application/project name"),
      version: z.string().optional().describe("Target version number"),
    },
    ({ appName, version }) => {
      const ver = version ?? "next";
      return userPrompt(
        "Release preparation: check schedule, collect changelog, create checklist, trigger build.",
        `"${appName}" v${ver} 릴리즈 준비를 해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **릴리즈 일정 확인**:
   - search_events("${appName} release", 향후 30일)로 릴리즈 일정 검색
   - get_upcoming_events로 가까운 마감일 확인
   - today_events로 오늘 관련 일정 확인

2. **체인지로그 수집**:
   - search_notes("${appName}")로 프로젝트 관련 메모 검색
   - search_notes("changelog"), search_notes("release") 키워드로도 검색
   - 찾은 메모를 read_note로 읽어서 변경사항 수집

3. **미완료 태스크 확인**:
   - search_reminders("${appName}")로 관련 리마인더 조회
   - list_reminders(completed: false)로 미완료 항목 확인
   - 릴리즈 블로커가 있는지 분류

4. **릴리즈 체크리스트 생성**: create_reminder_list("${appName} v${ver} Release")
   그리고 다음 항목을 create_reminder로 생성:
   - [ ] 코드 프리즈 확인
   - [ ] 테스트 통과 확인
   - [ ] 체인지로그 작성
   - [ ] 버전 번호 업데이트
   - [ ] 빌드 생성
   - [ ] QA 사인오프
   - [ ] 배포
   - [ ] 릴리즈 노트 발행

5. **빌드 트리거 (선택)**:
   - search_shortcuts("build")로 빌드 관련 단축어 확인
   - 빌드 단축어가 있으면 run_shortcut으로 실행할지 나에게 확인

6. **릴리즈 노트 초안**: create_note로 릴리즈 노트 초안 생성:
   - 제목: "[Release] ${appName} v${ver}"
   - 주요 변경사항
   - 버그 수정
   - 알려진 이슈
   - 업그레이드 가이드 (필요 시)

중요: 빌드 트리거 전에 반드시 확인을 받아. 체크리스트 항목은 상황에 맞게 조정해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: search_events 실패 시 list_events 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "idea-to-task",
    { idea: z.string().describe("Idea or feature description to break down into tasks") },
    ({ idea }) => {
      return userPrompt(
        "Idea to task pipeline: capture idea in Notes, decompose into tasks, create reminders, block calendar.",
        `"${idea}" 아이디어를 태스크로 분해해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **아이디어 기록**: create_note로 아이디어 노트 생성:
   - 제목: "[Idea] ${idea.slice(0, 50)}"
   - 아이디어 전문
   - 배경/동기
   - 예상 결과물

2. **태스크 분해**: 아이디어를 구현 가능한 태스크로 분해해:
   - 각 태스크는 2-4시간 단위로 분해
   - 의존성/선후관계 파악
   - 우선순위 지정 (1=높음, 5=보통, 9=낮음)
   - 결과를 나에게 보여주고 확인을 받아

3. **리마인더 생성**: 확인 후 create_reminder로 각 태스크 생성:
   - 제목: "[Task] {태스크명}"
   - body: 상세 설명 + 아이디어 노트 참조
   - priority: 우선순위
   - dueDate: 예상 완료일 (의존성 고려)

4. **개발 일정 블로킹**: create_event로 캘린더에 작업 시간 블록:
   - summary: "[Dev] {태스크명}"
   - 태스크별 예상 소요 시간만큼 블록
   - 기존 일정과 겹치지 않는 시간대로:
     get_upcoming_events로 기존 일정 확인 후 빈 시간에 배치

5. **결과 요약**:
   - 총 태스크 수
   - 예상 총 소요 시간
   - 타임라인 제안
   - 리스크/의존성 경고

중요: 태스크 분해 결과를 먼저 보여주고 확인받은 후에 리마인더/캘린더를 생성해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: create_reminder 실패 시 재시도 또는 다음 항목으로)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "build-log",
    { projectPath: z.string().describe("Project build output directory or project root") },
    ({ projectPath }) => {
      return userPrompt(
        "Build log analysis: check build output, log errors to Notes, celebrate success with Music.",
        `"${projectPath}" 빌드 결과를 분석해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **빌드 아웃풋 확인**:
   - list_directory("${projectPath}")로 프로젝트 구조 확인
   - search_files("${projectPath}", "build")로 빌드 아웃풋 디렉토리 찾기
   - recent_files("${projectPath}", days: 1)로 방금 생성/수정된 파일 확인
   - get_clipboard으로 클립보드에 빌드 로그가 있는지 확인

2. **결과 분석**:
   - 빌드 성공/실패 판단
   - 에러가 있으면 에러 메시지 분류
   - 경고(warning) 목록 정리

3. **실패 시 → 에러 로그 기록**:
   - create_note로 에러 로그 생성:
     제목: "[Build Error] ${projectPath.split("/").pop()} - {날짜}"
     - 에러 메시지 전문
     - 관련 파일 목록
     - 가능한 원인 분석
   - create_reminder로 수정 태스크 생성:
     제목: "[Fix Build] ${projectPath.split("/").pop()}"
     priority: 1 (긴급)

4. **성공 시 → 축하 🎉**:
   - show_notification("빌드 성공!", {title: "${projectPath.split("/").pop()}"})
   - now_playing으로 현재 음악 상태 확인
   - 음악이 안 틀어져 있으면:
     list_playlists로 재생목록 확인 →
     play_playlist로 좋아하는 플레이리스트 재생
   - create_note로 빌드 성공 로그:
     제목: "[Build OK] ${projectPath.split("/").pop()} - {날짜}"
     - 빌드 아웃풋 요약
     - 생성된 파일 목록

5. **요약 브리핑**:
   - 빌드 결과 (성공/실패)
   - 다음 단계 제안

중요: 빌드 결과는 실제 파일 시스템 데이터 기반으로 판단해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: search_files 실패 시 list_directory 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  // ── Professional Workflow Prompts ──

  server.prompt(
    "inbox-zero",
    "Professional email triage: scan, categorize, draft replies, create follow-ups, archive.",
    () => {
      const today = new Date().toISOString().split("T")[0];
      return userPrompt(
        "Inbox Zero workflow: triage all unread emails with categorization, replies, and follow-up actions.",
        `Inbox Zero 이메일 정리를 시작해줘. (${today})

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **수신함 스캔**:
   - list_mailboxes로 전체 메일함 현황과 미읽음 수 확인
   - list_accounts로 메일 계정 목록 확인
   - get_unread_count로 미읽음 총 개수 파악
   - list_messages(mailbox: "INBOX", unreadOnly: true)로 미읽음 메일 목록 가져오기

2. **메일 분류** — 각 미읽음 메일을 read_message로 읽고 분류해:
   - 🔴 **긴급 (Urgent)**: 즉시 대응 필요 (마감 임박, 장애, 상위 결재)
   - 🟡 **조치 필요 (Action)**: 답장/작업 필요하지만 시간 여유 있음
   - 🔵 **참고 (FYI)**: 읽기만 하면 되는 정보 공유
   - ⚪ **스팸/불필요**: 뉴스레터, 광고, 자동 알림

3. **긴급 항목 처리**:
   - today_events로 오늘 일정 확인하여 미팅 관련 메일 우선 처리
   - list_events로 향후 일정 조회하여 일정 충돌 확인
   - 각 긴급 메일에 대한 답장 초안 제안

4. **조치 필요 항목**:
   - create_reminder로 각 항목에 대한 팔로업 리마인더 생성:
     제목: "[메일] {발신자} - {제목 요약}"
     dueDate: 적절한 마감일
     body: 메일 ID 참조 + 필요한 조치 설명
   - 미팅 관련이면 search_events로 관련 일정 확인

5. **정리 작업**:
   - 처리 완료 메일: mark_message_read로 읽음 처리
   - 중요 메일: flag_message로 깃발 표시
   - 정리할 메일: move_message로 적절한 폴더로 이동
   - 스팸/불필요: 확인 후 이동 제안

6. **결과 요약**:
   - 분류별 메일 수
   - 생성된 리마인더 목록
   - 답장이 필요한 메일 목록과 초안
   - 일정 충돌 경고

중요: 메일 삭제나 답장 전송은 반드시 확인을 받아. 분류 결과를 먼저 보여주고 진행해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_messages 실패 시 search_messages 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "travel-planner",
    {
      destination: z.string().describe("Travel destination"),
      startDate: z.string().optional().describe("Trip start date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("Trip end date (YYYY-MM-DD)"),
    },
    ({ destination, startDate, endDate }) => {
      const start = startDate ?? "TBD";
      const end = endDate ?? "TBD";
      return userPrompt(
        "Trip planning workflow: calendar, Maps, reminders checklist, notes, and travel events.",
        `"${destination}" 여행 계획을 세워줘. (${start} ~ ${end})

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **일정 확인**:
   - list_events(startDate: "${start}", endDate: "${end}")로 여행 기간 기존 일정 확인
   - 충돌하는 일정이 있으면 목록으로 정리해서 경고

2. **목적지 탐색**:
   - search_location("${destination}")로 목적지 정보 검색
   - search_nearby("${destination}", category: "hotel")로 숙소 검색
   - search_nearby("${destination}", category: "restaurant")로 맛집 검색
   - get_directions로 이동 경로/시간 확인

3. **여행 체크리스트 생성**:
   - create_reminder_list("[여행] ${destination}")로 전용 리마인더 리스트 생성
   - 다음 항목을 create_reminder로 생성:
     - [ ] 숙소 예약
     - [ ] 교통편 예약 (비행기/기차/렌터카)
     - [ ] 여행자 보험
     - [ ] 짐 싸기
     - [ ] 여권/신분증 확인
     - [ ] 충전기/어댑터
     - [ ] 필수 의약품
     - [ ] 현지 통화/카드 준비
     - [ ] 비상 연락처 정리
     - [ ] 숙소 체크인 정보 확인
   각 리마인더에 적절한 마감일 설정

4. **여행 노트 폴더 생성**:
   - create_folder("[여행] ${destination}")로 Notes 폴더 생성
   - create_note로 다음 문서 생성:
     a. "[여행] ${destination} - 일정표": 날짜별 일정 계획
     b. "[여행] ${destination} - 예약 정보": 숙소, 교통편 예약 번호 기록용
     c. "[여행] ${destination} - 맛집/관광지": 검색 결과 정리

5. **캘린더 이벤트 생성** (확인 후):
   - create_event로 여행 기간 이벤트 생성:
     summary: "[여행] ${destination}"
     allDay: true (여행 기간 전체)
   - 출발/도착 시간 이벤트 별도 생성

6. **결과 브리핑**:
   - 여행 기간 일정 충돌 여부
   - 생성된 체크리스트 요약
   - 목적지 주요 정보 (위치, 이동시간)
   - 추가로 준비할 사항 제안

중요: 캘린더 이벤트 생성 전에 반드시 확인을 받아. 기존 일정과의 충돌을 반드시 알려줘.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: search_location 실패 시 search_nearby 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "content-curator",
    { topic: z.string().describe("Research topic or content area to curate") },
    ({ topic }) => {
      const today = new Date().toISOString().split("T")[0];
      return userPrompt(
        "Content curation workflow: gather from Safari, summarize, organize in Notes, tag files, set follow-ups.",
        `"${topic}" 주제로 콘텐츠를 수집하고 정리해줘. (${today})

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **Safari 탭 수집**:
   - list_tabs로 현재 열린 모든 Safari 탭 확인
   - "${topic}" 관련 탭을 식별
   - 관련 탭을 read_page_content로 하나씩 읽기
   - list_reading_list에서 관련 항목 확인
   - list_bookmarks에서 관련 북마크 확인

2. **콘텐츠 분석 및 요약**:
   - 수집한 각 페이지의 핵심 내용 추출
   - ai_status로 Apple Intelligence 사용 가능 여부 확인
   - 사용 가능하면: summarize_text로 각 페이지 요약 생성
   - 사용 불가하면: 직접 핵심 포인트 3-5개로 요약

3. **기존 자료 확인**:
   - search_notes("${topic}")로 기존 관련 메모 검색
   - search_files(query: "${topic}")로 관련 파일 검색
   - 기존 자료가 있으면 read_note로 내용 확인하여 중복 방지

4. **Notes에 정리**:
   - create_folder("[리서치] ${topic}") 폴더 생성 (없으면)
   - create_note로 종합 리서치 노트 생성:
     제목: "[리서치] ${topic} - ${today}"
     내용 구조:
     - 개요/배경
     - 핵심 발견 사항 (번호 매기기)
     - 각 소스별 요약
     - 출처 URL 목록
     - 미해결 질문/추가 조사 필요 사항
     - 기존 메모와의 연관성

5. **파일 태깅**:
   - 관련 파일이 있으면 set_file_tags로 태그 적용:
     태그 제안: "${topic}", "리서치", "참고자료"
   - 태그 적용 전 확인 요청

6. **팔로업 설정**:
   - create_reminder로 후속 작업 리마인더 생성:
     - "[리서치] ${topic} 추가 조사" (미해결 항목용)
     - "[리서치] ${topic} 리뷰" (1주 후 리뷰용)
   - 관련 URL을 add_to_reading_list로 리딩 리스트에 추가

7. **결과 요약**:
   - 수집된 소스 수
   - 핵심 발견 사항 TOP 5
   - 생성된 노트/리마인더 목록
   - 추가 조사 제안

중요: 출처 URL을 반드시 포함해. 요약은 원문의 맥락을 보존하되 간결하게.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: read_page_content 실패 시 다른 탭 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "morning-brief",
    "Comprehensive morning briefing: calendar, reminders, email, notes, music, system status.",
    () => {
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
      const tomorrowEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2).toISOString();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const dateStr = today.toISOString().split("T")[0];
      return userPrompt(
        "Morning briefing: full daily overview with calendar, emails, reminders, notes, music, and system status.",
        `좋은 아침! 오늘(${dateStr}) 모닝 브리핑을 해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **오늘 일정** (상세):
   - today_events로 오늘 이벤트 전체 조회
   - list_events(startDate: "${todayStart}", endDate: "${todayEnd}")로 시간순 정렬
   - 각 이벤트의 준비 사항 분석:
     - 미팅이면: 참석자 확인, 관련 메모 search_notes로 검색
     - 발표/리뷰면: 관련 파일 search_files로 확인
   - list_events(startDate: "${todayEnd}", endDate: "${tomorrowEnd}")로 내일 일정도 미리 보기

2. **리마인더 현황**:
   - list_reminders(completed: false)로 미완료 리마인더 전체 조회
   - 분류:
     - 🔴 기한 지남 (overdue)
     - 🟡 오늘 마감
     - 🟢 이번 주 마감
     - ⚪ 기한 미지정
   - 우선순위(priority) 기준 정렬

3. **이메일 요약**:
   - get_unread_count로 미읽음 메일 수 확인
   - list_messages(mailbox: "INBOX", unreadOnly: true, limit: 10)로 최근 미읽음 메일 목록
   - 각 메일의 발신자/제목으로 우선순위 판단:
     - 상사/팀원 메일 → 우선
     - 외부 파트너 → 중요
     - 뉴스레터/알림 → 나중에

4. **최근 메모 활동**:
   - scan_notes로 메모 스캔
   - ${yesterday} 이후 생성/수정된 메모 필터링
   - 어제 작업하던 내용 요약

5. **음악 추천**:
   - now_playing으로 현재 재생 상태 확인
   - list_playlists로 사용 가능한 재생목록 확인
   - 아침에 어울리는 플레이리스트 추천

6. **시스템 상태**:
   - get_battery_status로 배터리 잔량 확인
   - get_wifi_status로 네트워크 연결 상태 확인
   - get_brightness로 화면 밝기 확인

7. **종합 브리핑 형식**:

🌅 **모닝 브리핑 — ${dateStr}**

📅 **오늘 일정** (N건)
- 시간순 이벤트 + 준비사항
- 빈 시간대 (집중 작업 가능)

⏰ **마감/긴급 리마인더** (N건)
- overdue 항목 강조
- 오늘 마감 항목

📧 **이메일** (미읽음 N건)
- 우선 확인 필요 메일 TOP 3
- 나머지 요약

📝 **어제 이어서**
- 최근 수정 메모 요약

🎵 **추천 플레이리스트**
- 아침 작업용 추천

🔋 **시스템**
- 배터리, Wi-Fi, 밝기 상태

💡 **오늘의 제안**
- 가장 먼저 할 일
- 준비가 필요한 미팅
- 집중 작업 추천 시간대

중요: 모든 데이터는 실제 AirMCP 도구로 조회해서 정확한 정보를 제공해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_messages 실패 시 get_unread_count만 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "project-kickoff",
    {
      projectName: z.string().describe("Name of the new project"),
      description: z.string().optional().describe("Brief project description"),
    },
    ({ projectName, description }) => {
      const desc = description ?? projectName;
      const today = new Date().toISOString().split("T")[0];
      return userPrompt(
        "Project kickoff: create folder, notes, reminders, calendar events, and bookmarks for a new project.",
        `"${projectName}" 프로젝트를 시작해줘. (${today})
${description ? `프로젝트 설명: ${description}` : ""}

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **프로젝트 폴더 생성** (Finder):
   - create_directory("~/Projects/${projectName}")로 프로젝트 루트 폴더 생성
   - create_directory("~/Projects/${projectName}/docs")로 문서 폴더 생성
   - create_directory("~/Projects/${projectName}/resources")로 리소스 폴더 생성

2. **Notes 폴더 및 문서 생성**:
   - create_folder("[프로젝트] ${projectName}")로 Notes 폴더 생성
   - create_note로 핵심 문서 생성:
     a. "[프로젝트] ${projectName} - 개요":
        - 프로젝트명: ${projectName}
        - 설명: ${desc}
        - 시작일: ${today}
        - 목표/범위
        - 팀원/역할
        - 주요 마일스톤
     b. "[프로젝트] ${projectName} - 회의록":
        - 킥오프 미팅부터 기록용
     c. "[프로젝트] ${projectName} - 의사결정 로그":
        - 주요 결정사항 추적용

3. **리마인더 리스트 및 태스크 생성**:
   - create_reminder_list("[프로젝트] ${projectName}")로 전용 리스트 생성
   - 초기 태스크를 create_reminder로 생성:
     - [ ] 프로젝트 요구사항 정의
     - [ ] 기술 스택 결정
     - [ ] 마일스톤 일정 수립
     - [ ] 팀 역할 배분
     - [ ] 개발 환경 구성
     - [ ] 초기 설계 문서 작성
   각 태스크에 우선순위와 예상 마감일 설정

4. **캘린더 반복 이벤트** (확인 후):
   - create_recurring_event로 정기 미팅 생성:
     a. "[${projectName}] 데일리 스탠드업" — 매일 (월~금)
     b. "[${projectName}] 주간 리뷰" — 매주
     c. "[${projectName}] 스프린트 회고" — 격주
   - 시간은 나에게 확인 후 설정

5. **Safari 리소스** (선택):
   - 프로젝트 관련 URL이 있으면:
     add_bookmark으로 북마크 추가
     add_to_reading_list로 리딩 리스트에 추가
   - 나에게 참고 URL이 있는지 물어봐

6. **프로젝트 파일 태깅**:
   - set_file_tags("~/Projects/${projectName}", tags: ["프로젝트", "${projectName}"])

7. **킥오프 알림**:
   - show_notification("${projectName} 프로젝트가 시작되었습니다!", {title: "Project Kickoff"})

8. **결과 요약**:
   - 생성된 폴더 구조
   - 생성된 노트 목록
   - 생성된 리마인더 목록
   - 생성된 캘린더 이벤트 (있으면)
   - 다음 단계 제안

중요: 캘린더 이벤트는 시간 확인 후 생성. 폴더/노트/리마인더는 바로 생성 가능.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: create_folder 실패 시 기본 폴더에 노트 생성)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "weekly-review",
    { days: z.number().int().min(1).max(14).optional().describe("Review period in days (default: 7)") },
    ({ days }) => {
      const n = days ?? 7;
      const now = new Date();
      const since = new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
      const until = now.toISOString();
      const dateStr = now.toISOString().split("T")[0];
      const sinceStr = since.split("T")[0];
      return userPrompt(
        "Weekly review: completed tasks, events attended, notes activity, email stats, photos, music, and summary.",
        `주간 리뷰를 시작해줘. (${sinceStr} ~ ${dateStr}, ${n}일간)

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. **완료한 리마인더**:
   - list_reminders(completed: true)로 완료 리마인더 조회
   - ${sinceStr} 이후 완료된 항목만 필터링
   - 리스트별 완료 수 집계
   - list_reminders(completed: false)로 미완료 항목 조회
   - 기한 지난(overdue) 항목 식별

2. **캘린더 이벤트 회고**:
   - list_events(startDate: "${since}", endDate: "${until}")로 기간 내 이벤트 조회
   - 이벤트 유형 분류 (미팅, 개인, 집중시간 등)
   - 총 미팅 시간 계산
   - 빈 시간 / 집중 시간 비율 분석

3. **메모 활동**:
   - scan_notes로 전체 메모 스캔
   - ${sinceStr} 이후 생성/수정된 메모 필터링
   - 주제별 분류
   - 활발하게 작업한 메모 TOP 5

4. **이메일 현황**:
   - list_mailboxes로 메일함 상태 확인
   - get_unread_count로 현재 미읽음 수
   - search_messages로 기간 내 발신 메일 확인 (보낸편지함)
   - 메일 처리 현황 요약

5. **사진 기록**:
   - list_photos(limit: 20)로 최근 사진 확인
   - ${sinceStr} 이후 촬영/추가된 사진 필터링
   - 이번 주 사진 수 및 주요 앨범

6. **음악 활동**:
   - now_playing으로 현재 재생 상태
   - list_playlists로 재생목록 확인
   - 최근 들은 음악 트렌드 파악

7. **주간 리뷰 노트 생성**: create_note로 리뷰 노트 작성:
   제목: "[주간 리뷰] ${sinceStr} ~ ${dateStr}"

   📊 **성과 요약**
   - 완료한 리마인더: N/M (완료율)
   - 참석한 미팅: N건 (총 N시간)
   - 작성/수정한 메모: N건
   - 처리한 이메일: N건

   ✅ **이번 주 완료 항목**
   - 완료 리마인더 목록

   ⚠️ **이월 항목**
   - 미완료 리마인더 (기한 지남 강조)

   📅 **캘린더 분석**
   - 미팅 비율 vs 집중 시간
   - 가장 바빴던 날

   📝 **메모 활동**
   - 활발한 주제 분석

   🎯 **다음 주 제안**
   - 이월 항목 우선 처리
   - 일정 최적화 제안
   - 정리 필요 사항

8. **후속 리마인더 생성**:
   - create_reminder("[주간 리뷰] 이월 항목 정리", dueDate: 다음 월요일)
   - 필요하면 추가 팔로업 리마인더

중요: 모든 데이터는 실제 AirMCP 도구로 조회해. 통계는 정확한 수치를 제공해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_reminders 실패 시 search_reminders 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );
}
