# iConnect MCP 디렉토리 등록 가이드

> 2026-03-14 기준 전체 MCP 마켓플레이스 리스트. 복붙용 정보 + 등록 상태 포함.

---

## 공통 복붙 정보

```
Name: iConnect
Description: MCP server for the entire Apple ecosystem — Notes, Reminders, Calendar, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Apple Intelligence, and TV.
Repository: https://github.com/heznpc/iConnect
npm: https://www.npmjs.com/package/iconnect-mcp
Install: npx -y iconnect-mcp
Tools: 123 tools, 23 prompts, 11 resources across 14 modules
Transport: stdio (default) + HTTP/SSE (--http)
License: MIT
Author: heznpc
```

Claude Desktop Config (복붙용):
```json
{
  "mcpServers": {
    "iconnect": {
      "command": "npx",
      "args": ["-y", "iconnect-mcp"]
    }
  }
}
```

---

## 등록 상태 요약

| # | 플랫폼 | 방식 | 상태 |
|---|--------|------|------|
| 1 | **MCP Registry** (공식) | CLI `mcp-publisher` | ⏳ 인증 대기 |
| 2 | **awesome-mcp-servers** (punkpeye) | GitHub PR | ✅ PR 제출 |
| 3 | **awesome-mcp-servers** (appcypher) | GitHub PR | ✅ PR 제출 |
| 4 | **Smithery** | CLI `smithery` | ⏳ 인증 대기 |
| 5 | **mcp.so** | 웹 폼 | 📋 TODO (수동) |
| 6 | **PulseMCP** | 웹 폼 | 📋 TODO (수동) |
| 7 | **Glama** | 웹 폼 + GitHub OAuth | 📋 TODO (수동) |
| 8 | **cursor.directory** | 웹 폼 | 📋 TODO (수동) |
| 9 | **mcpservers.org** | 웹 폼 | 📋 TODO (수동) |
| 10 | **MCP Market** | 웹 폼 | 📋 TODO (수동) |
| 11 | **MCPServers.com** | 웹 폼 + Google Auth | 📋 TODO (수동) |
| 12 | **MCP.ing** | 웹 폼 | 📋 TODO (수동) |
| 13 | **Claude Integrations** (Anthropic) | 웹 폼 + 리뷰 | 📋 TODO (수동) |
| 14 | **MCPHub.io** | 미확인 | ❓ 확인 필요 |
| 15 | **OpenTools** | 베타 (연락 필요) | ⏸️ 보류 |

### 제외 플랫폼

| 플랫폼 | 사유 |
|--------|------|
| Composio MCP (mcp.composio.dev) | Deprecated 공지 |
| mcp.directory | 도메인 매물 |
| mcpcentral.ai | 도메인 매물 |
| claudemcp.com | 접속 불가 |
| mcpdb.io | 접속 불가 |
| mcpservers.ai | 접속 불가 |
| mcp.run / TurboMCP | 리디렉트, 실체 불명 |
| mcptools.io | 트래킹 페이지 |
| aimcphub.com | 트래킹 페이지 |
| MCPHub.com | API 게이트웨이 (디렉토리 아님) |

---

## 1. MCP Registry (공식, Anthropic/MCP)

| 항목 | 내용 |
|------|------|
| URL | https://registry.modelcontextprotocol.io/ |
| GitHub | https://github.com/modelcontextprotocol/registry |
| 인증 | GitHub OAuth (`mcp-publisher login github`) |
| 방식 | `mcp-publisher` CLI + `server.json` |
| 상태 | ⏳ GitHub 디바이스 인증 대기 |

### 준비 완료

- `server.json` ✅ (레포 루트에 이미 존재)
- `package.json`의 `mcpName` ✅ (`io.github.heznpc/iconnect`)
- `mcp-publisher` CLI ✅ (brew install 완료)

### 인증 후 실행할 명령

```bash
cd /Users/ren/IdeaProjects/iConnect
mcp-publisher publish
```

---

## 2. awesome-mcp-servers (punkpeye) — ✅ PR 제출

| 항목 | 내용 |
|------|------|
| URL | https://github.com/punkpeye/awesome-mcp-servers |
| Stars | 83,000+ |
| PR | https://github.com/punkpeye/awesome-mcp-servers/pull/3169 |
| 섹션 | Workplace & Productivity |

---

## 3. awesome-mcp-servers (appcypher) — ✅ PR 제출

| 항목 | 내용 |
|------|------|
| URL | https://github.com/appcypher/awesome-mcp-servers |
| Stars | 5,200+ |
| PR | https://github.com/appcypher/awesome-mcp-servers/pull/582 |
| 섹션 | System Automation |

---

## 4. Smithery

| 항목 | 내용 |
|------|------|
| URL | https://smithery.ai |
| 인증 | OAuth (CLI: `smithery auth login`) |
| 방식 | `smithery.yaml` + CLI 퍼블리시 |
| 상태 | ⏳ 브라우저 인증 대기 |

### 준비 완료

- `smithery.yaml` ✅ (레포 루트에 이미 존재)
- `@smithery/cli` ✅ (npm -g 설치 완료)

### 인증 후 실행할 명령

```bash
cd /Users/ren/IdeaProjects/iConnect
smithery mcp publish --name iconnect --transport stdio
```

---

## 5. mcp.so — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://mcp.so/submit |
| 인증 | GitHub 또는 Google 로그인 |
| 서버 수 | 18,487+ |

### 폼 필드

| 필드 | 필수 | 입력값 |
|------|------|--------|
| Type | O | `MCP Server` |
| Name | O | `iConnect` |
| URL | O | `https://github.com/heznpc/iConnect` |
| Server Config | X | 위 Claude Desktop Config JSON 붙여넣기 |

### 참고
- 등록 후 GitHub README 자동 렌더링
- https://mcp.so/my-servers 에서 태그/카테고리 수정 가능

---

## 6. PulseMCP — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://pulsemcp.com/submit |
| 운영 | Tadas Antanavicius (MCP Steering Committee 멤버) |
| 서버 수 | 10,060+ |
| 특징 | 주간 뉴스레터, 보안 분석, 인기도 메트릭 |

### 제출
1. https://pulsemcp.com/submit 접속
2. 웹 폼 작성 (공통 복붙 정보 사용)
3. 또는 이메일: hello@pulsemcp.com

---

## 7. Glama — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://glama.ai/mcp/servers → "Add Server" |
| 인증 | GitHub OAuth |
| 서버 수 | 19,198+ |

### 준비 완료

- `glama.json` ✅ (레포 루트에 이미 존재, maintainer: heznpc)
- `LICENSE` ✅ (MIT)

### 등록
1. https://glama.ai/mcp/servers 접속
2. "Add Server" 클릭
3. GitHub 로그인
4. 이미 자동 인덱싱되었을 수 있음 → "Claim ownership"

---

## 8. cursor.directory — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://cursor.directory/mcp/new |
| 인증 | GitHub 또는 Google 로그인 |
| 유저 | 월 25만+ 활성 개발자 |

### 폼 필드

| 필드 | 필수 | 입력값 |
|------|------|--------|
| Name | O | `iConnect` |
| Description | O | `MCP server for the entire Apple ecosystem — Notes, Reminders, Calendar, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Apple Intelligence, and TV. 123 tools across 14 modules.` |
| Link | O | `https://github.com/heznpc/iConnect` |
| Logo | X | 있으면 업로드 |
| Cursor Deep Link | X | https://docs.cursor.com/tools/developers#generate-install-link 에서 생성 |

---

## 9. mcpservers.org — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://mcpservers.org/submit |
| 인증 | 불필요 |
| 비용 | 무료 (프리미엄 $39 옵션) |

### 폼 필드

| 필드 | 입력값 |
|------|--------|
| Server Name | `iConnect` |
| Short Description | `MCP server for the entire Apple ecosystem — 123 tools across 14 Apple app modules` |
| Link | `https://github.com/heznpc/iConnect` |
| Category | `Productivity` |
| Contact Email | (본인 이메일) |

### 참고
- 프리미엄 ($39): 빠른 리뷰, 공식 뱃지, dofollow 링크

---

## 10. MCP Market — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://mcpmarket.com/submit |
| 인증 | 불필요 |

### 제출
1. https://mcpmarket.com/submit 접속
2. GitHub URL 입력: `https://github.com/heznpc/iConnect`
3. 자동 MCP 호환성 검증 + 등록

---

## 11. MCPServers.com — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://mcpservers.com |
| 인증 | Google 로그인 필요 |
| 서버 수 | 2,227+ |

### 제출
1. "Add Server" 클릭
2. Google 로그인
3. GitHub URL, 이름, 카테고리, 로고 URL 입력

---

## 12. MCP.ing — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://mcp.ing |
| 방식 | "Submit MCP" 버튼 |

### 제출
1. https://mcp.ing 접속
2. "Submit MCP" 클릭
3. 폼 작성 (공통 복붙 정보 사용)

---

## 13. Claude Integrations (Anthropic 공식) — 📋 TODO (수동)

| 항목 | 내용 |
|------|------|
| URL | https://claude.com/docs/connectors/building/submission |
| 리뷰 기간 | ~2주 |
| 난이도 | 높음 (가장 까다로운 심사) |

### 요구사항 체크리스트

| 요구사항 | 상태 |
|----------|------|
| Tool annotations (`readOnlyHint`/`destructiveHint`) | ✅ 모든 도구에 적용됨 |
| OAuth 2.0 (인증 서비스인 경우) | N/A (로컬 서버) |
| Privacy Policy | ✅ `PRIVACY_POLICY.md` 존재 |
| 설치/사용 문서 | ✅ README.md |
| 서버 로고/브랜딩 | ❌ 미준비 |
| 테스트 계정 + 설정 가이드 | ❌ 미준비 (macOS 필요) |
| 보안 기준 준수 | ✅ SECURITY.md 존재 |
| 도구/리소스/프롬프트 전체 목록 | ✅ README.md에 포함 |

### 참고
- Claude.ai 내부에 직접 노출되는 가장 영향력 있는 리스팅
- 로고와 테스트 환경 준비 필요
- macOS 전용이라 리뷰어가 Mac 필요 → 테스트 가이드 상세히 작성할 것

---

## 14. MCPHub.io — ❓ 확인 필요

| 항목 | 내용 |
|------|------|
| URL | https://mcphub.io |
| 방식 | SPA 기반, 제출 프로세스 미확인 |

### TODO
- 직접 방문하여 "Add Server" 또는 제출 방법 확인

---

## 15. OpenTools — ⏸️ 보류

| 항목 | 내용 |
|------|------|
| URL | https://opentools.com |
| 상태 | 베타 (얼리 액세스) |
| 방식 | Calendly 미팅 또는 Discord |

### TODO (베타 종료 후)
- https://opentools.com 에서 정식 출시 확인
- Registry API 활용 가능 여부 확인

---

## 레포에 필요한 파일 상태

| 파일 | 대상 플랫폼 | 상태 |
|------|-------------|------|
| `server.json` | MCP Registry | ✅ 존재 |
| `smithery.yaml` | Smithery | ✅ 존재 |
| `glama.json` | Glama | ✅ 존재 |
| `package.json` `mcpName` | MCP Registry | ✅ 존재 |
| 로고/아이콘 | Claude Integrations, cursor.directory 등 | ❌ 미준비 |

---

## TODO 요약 (수동 작업 필요)

### 즉시 가능 (각 2분)
1. **mcp.so** → https://mcp.so/submit
2. **MCP Market** → https://mcpmarket.com/submit
3. **MCP.ing** → https://mcp.ing

### 로그인 필요 (각 5분)
4. **cursor.directory** → https://cursor.directory/mcp/new (GitHub/Google)
5. **Glama** → https://glama.ai/mcp/servers (GitHub OAuth)
6. **mcpservers.org** → https://mcpservers.org/submit
7. **MCPServers.com** → https://mcpservers.com (Google Auth)
8. **PulseMCP** → https://pulsemcp.com/submit

### 준비 필요
9. **Claude Integrations** → 로고 제작 + 테스트 가이드 작성 후 제출
10. **MCPHub.io** → 사이트 방문 후 제출 방법 확인
