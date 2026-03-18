import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";

import { userPrompt } from "../shared/prompt.js";

export function registerNotePrompts(server: McpServer): void {
  server.prompt(
    "organize-notes",
    { folder: z.string().optional().describe("Source folder to organize. Defaults to 'Notes'.") },
    ({ folder }) => {
      const target = folder ?? "Notes";
      return userPrompt(
        "Scan all notes, classify by topic, create folders, and move notes into them.",
        `Apple Notes의 "${target}" 폴더에 있는 메모를 정리해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. scan_notes(folder: "${target}")로 해당 폴더의 메모를 스캔해. 메모가 많으면 offset으로 페이징해서 전부 확인해
2. 스캔 결과를 분석해서 주제별로 분류해
3. 분류 결과를 나에게 보여주고 확인을 받아
4. 확인 후 create_folder로 필요한 폴더를 생성해
5. bulk_move_notes로 메모를 해당 폴더로 실제 이동시켜

중요: MD 파일을 작성하지 말고, 실제 Apple Notes 앱에서 폴더를 만들고 메모를 이동해야 해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: scan_notes 실패 시 list_notes 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "find-duplicates",
    { folder: z.string().optional().describe("Folder to scan for duplicates. Defaults to all.") },
    ({ folder }) => {
      const scope = folder ? `"${folder}" 폴더의` : "전체";
      return userPrompt(
        "Find duplicate or similar notes, compare content, and suggest cleanup.",
        `Apple Notes에서 ${scope} 중복/유사 메모를 찾아서 정리해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. scan_notes로 메모를 스캔해 (folder 파라미터로 범위 지정 가능, offset으로 페이징)
2. 제목이나 미리보기가 비슷한 메모 그룹을 찾아
3. compare_notes로 유사 메모들의 전체 내용을 비교해
4. 각 그룹별로 "어떤 걸 남기고 어떤 걸 삭제할지" 제안해
5. 나의 확인 후 delete_note로 중복 메모를 삭제해

중요: 삭제 전에 반드시 나에게 확인을 받아. 미리보기만 보고 판단하지 말고 compare_notes로 전체 내용을 확인해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: compare_notes 실패 시 read_note로 개별 확인)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );

  server.prompt(
    "notes-weekly-review",
    "Summarize notes from the past week and suggest organization actions.",
    () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return userPrompt(
        "Summarize notes from the past week and suggest organization actions.",
        `Apple Notes 주간 리뷰를 해줘.

다음 단계를 반드시 AirMCP 도구를 사용해서 실행해:

1. scan_notes로 전체 메모를 스캔해 (메모가 많으면 offset으로 페이징)
2. ${oneWeekAgo} 이후에 생성되거나 수정된 메모만 필터링해
3. 이번 주 메모를 주제별로 요약해줘
4. 정리가 필요한 메모가 있으면 제안해 (미분류, 빈 메모 등)
5. 내가 원하면 폴더 이동이나 삭제를 실행해

중요: 실제 AirMCP 도구를 사용해서 Apple Notes 데이터를 조회해.

에러 처리:
- 도구 호출 실패 시 사용자에게 알리고 대안 도구 시도 (예: scan_notes 실패 시 list_notes 시도)
- 권한 에러 시 setup_permissions 안내
- 앱이 응답하지 않으면 다음 단계로 건너뛰기`,
      );
    },
  );
}
