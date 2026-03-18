import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";

import { userPrompt } from "../shared/prompt.js";

export function registerReminderPrompts(server: McpServer): void {
  server.prompt(
    "organize-reminders",
    { list: z.string().optional().describe("List to organize. Defaults to all lists.") },
    ({ list }) => {
      const scope = list ? `"${list}" 리스트의` : "전체";
      return userPrompt(
        "Scan reminders, identify overdue/completed, and suggest cleanup.",
        `Apple Reminders에서 ${scope} 리마인더를 정리해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. list_reminder_lists로 모든 리스트를 확인해
2. list_reminders로 리마인더를 조회해 (list, completed 필터 사용 가능)
3. 완료된 리마인더, 기한 지난 리마인더, 중복 항목을 분류해
4. 정리 방안을 나에게 제안해:
   - 완료된 항목 일괄 삭제
   - 기한 지난 항목 업데이트 또는 삭제
   - 비슷한 항목 통합
5. 나의 확인 후 delete_reminder 또는 update_reminder로 실행해

중요: 삭제 전에 반드시 나에게 확인을 받아.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_reminders 실패 시 search_reminders 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "daily-review",
    "Review today's due reminders and suggest priorities.",
    () => {
      const today = new Date().toISOString().split("T")[0];
      return userPrompt(
        "Review today's due reminders, flag overdue items, and suggest priorities.",
        `오늘(${today})의 리마인더를 리뷰해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. list_reminders(completed: false)로 미완료 리마인더를 모두 조회해
2. 오늘 마감인 항목과 이미 기한이 지난 항목을 분류해
3. 우선순위별로 정리해서 보여줘:
   - 🔴 기한 지남 (overdue)
   - 🟡 오늘 마감
   - 🟢 이번 주 내 마감
   - ⚪ 마감일 없음
4. 우선 처리할 항목을 제안해
5. 내가 원하면 complete_reminder로 완료 처리하거나 update_reminder로 기한을 변경해

중요: 실제 AirMCP 도구를 사용해서 Apple Reminders 데이터를 조회해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: list_reminders 실패 시 search_reminders 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );
}
