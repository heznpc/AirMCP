import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const doc = readFileSync(new URL("docs/ios-architecture.md", root), "utf8");
const rfc0007 = readFileSync(
  new URL("docs/rfc/0007-app-intent-bridge.md", root),
  "utf8",
);
const handwrittenIntents = readFileSync(
  new URL("app/Sources/AirMCPApp/AppIntents.swift", root),
  "utf8",
);

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

  test("keeps RFC 0007 scoped to codegen, not an automatic MCP bridge", () => {
    expect(rfc0007).toContain("MCP Tool → App Intent Codegen");
    expect(rfc0007).toContain("App Intents are the Siri/Shortcuts/Spotlight surface");
    expect(rfc0007).not.toContain("NSAppIntentsMCPExposure");
    expect(rfc0007).not.toContain("@MCPExposedIntent");
    expect(rfc0007).not.toContain("the system exposes it as an MCP tool");
  });

  test("keeps hand-written AppIntent comments out of the old MCP-bridge frame", () => {
    expect(handwrittenIntents).toContain("MCP clients use the HTTP/stdio AirMCP surfaces");
    expect(handwrittenIntents).not.toContain("system-level MCP↔App Intents bridge");
    expect(handwrittenIntents).not.toContain("automatically be available to all MCP clients");
  });
});
