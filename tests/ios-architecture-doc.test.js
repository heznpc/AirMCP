import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const doc = readFileSync(new URL("docs/ios-architecture.md", root), "utf8");

describe("iOS architecture doc honesty", () => {
  test("does not present App Intents as an automatic iOS MCP transport", () => {
    expect(doc).not.toContain("MCP↔App Intents");
    expect(doc).not.toContain("MCP Tool ↔ App Intent auto-bridge");
    expect(doc).not.toContain('"type": "app-intents"');
    expect(doc).not.toContain("시스템 MCP 등록 + 오프라인 에이전트");
    expect(doc).not.toContain("Apple이 iOS 26.1에서 MCP");
  });

  test("documents the Apple-surface / MCP-surface split", () => {
    expect(doc).toContain("consumer/Siri path = App Intents");
    expect(doc).toContain("developer/agent path = MCP/Xcode");
    expect(doc).toContain("HTTP MCP 서버 + App Intents/App Schemas");
    expect(doc).toContain("MCP 클라이언트는 계속 HTTP/stdio transport를 통해 붙고");
  });
});
