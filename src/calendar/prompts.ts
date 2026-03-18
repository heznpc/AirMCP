import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";

import { userPrompt } from "../shared/prompt.js";

export function registerCalendarPrompts(server: McpServer): void {
  server.prompt(
    "schedule-review",
    { days: z.number().int().min(1).max(90).optional().describe("Number of days ahead to review (default: 7)") },
    ({ days }) => {
      const n = days ?? 7;
      const start = new Date().toISOString();
      const end = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
      return userPrompt(
        `Review upcoming ${n} days of events, identify conflicts, and suggest optimizations.`,
        `앞으로 ${n}일간의 캘린더 일정을 리뷰해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. list_calendars로 모든 캘린더를 확인해
2. list_events(startDate: "${start}", endDate: "${end}")로 일정을 조회해
3. 다음 항목을 분석해:
   - 시간이 겹치는 일정 (충돌)
   - 연속 회의로 쉬는 시간이 없는 구간
   - 빈 시간대 (여유 시간)
4. 개선 제안을 해줘:
   - 충돌 해결 방안
   - 일정 재배치 제안
   - 집중 업무 시간 확보 제안
5. 내가 원하면 update_event로 일정을 수정해

중요: 실제 AirMCP 도구를 사용해서 Apple Calendar 데이터를 조회해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_events 실패 시 search_events 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "meeting-prep",
    { eventId: z.string().describe("Event ID to prepare for") },
    ({ eventId }) => {
      return userPrompt(
        "Read event details, find related notes, and prepare meeting context.",
        `미팅 준비를 도와줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. read_event(id: "${eventId}")로 이벤트 상세 정보를 확인해
2. 이벤트 제목과 참석자 정보를 파악해
3. search_notes로 관련 메모를 검색해 (이벤트 제목, 참석자 이름으로 검색)
4. 다음 내용을 정리해줘:
   - 미팅 기본 정보 (시간, 장소, 참석자)
   - 관련 메모 요약
   - 준비할 사항 제안
   - 예상 안건

중요: 실제 AirMCP 도구를 사용해서 Apple Calendar와 Notes 데이터를 조회해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: read_event 실패 시 search_events로 이벤트 검색)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );
}
