import { afterEach, describe, expect, test } from "@jest/globals";
import { createMockServer } from "./helpers/mock-server.js";
import { createMockConfig } from "./helpers/mock-config.js";

const { createToolRegistry } = await import("../dist/shared/tool-registry.js");
const { getCorrelationId, runWithRequestContext } = await import("../dist/shared/request-context.js");
const { registerToolSessionTools } = await import("../dist/server/tool-session-tools.js");
const { toolSessions } = await import("../dist/shared/tool-sessions.js");

afterEach(() => {
  toolSessions.resetForTests();
});

describe("Trust Center progressive tool-session contract", () => {
  test("keeps audit_log hidden while run_tool preserves governance context and scoped cleanup", async () => {
    const server = createMockServer();
    const registry = createToolRegistry();
    registry.configureExposure({
      mode: "progressive",
      exposedToolNames: new Set(["start_tool_session", "run_tool", "end_tool_session"]),
    });
    registry.installOn(server);

    let observedCorrelationId;
    server.registerTool(
      "audit_log",
      {
        title: "Audit Log",
        description: "Hidden Trust Center evidence target",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        observedCorrelationId = getCorrelationId();
        return {
          content: [{ type: "text", text: JSON.stringify({ returned: 1 }) }],
          structuredContent: { returned: 1 },
        };
      },
    );

    const config = createMockConfig({
      requireToolSession: true,
      features: { usageTracking: false, proactiveContext: false },
    });
    const harness = {
      name: "app-runtime",
      requireSessionForHiddenTools: true,
      maxSessionTools: 64,
      defaultSessionTtlSeconds: 900,
      maxSessionTtlSeconds: 3600,
      discoveryDescriptionMode: "summary",
    };
    registerToolSessionTools(server, { config, harness, toolRegistry: registry });

    expect(server._tools.has("audit_log")).toBe(false);
    expect(registry.getToolDetails("audit_log")).toMatchObject({ exposed: false });

    const unscoped = await server.callTool("run_tool", { name: "audit_log", args: {} });
    expect(unscoped.isError).toBe(true);
    expect(unscoped.content[0].text).toContain('Tool session required for hidden tool "audit_log"');

    const started = await server.callTool("start_tool_session", {
      tools: ["audit_log"],
      ttlSeconds: 150,
      label: "AirMCP Trust Center evidence read",
    });
    const sessionId = started.structuredContent.sessionId;
    expect(started.structuredContent.remainingSeconds).toBeGreaterThan(120);
    expect(started.structuredContent.remainingSeconds).toBeLessThanOrEqual(150);
    expect(toolSessions.activeCount()).toBe(1);

    const runID = "77777777-7777-4777-8777-777777777777";
    const delegated = await runWithRequestContext({ correlationId: runID }, () =>
      server.callTool("run_tool", {
        name: "audit_log",
        args: { limit: 25 },
        sessionId,
      }),
    );
    expect(delegated.isError).toBeFalsy();
    expect(delegated.structuredContent).toEqual({ returned: 1 });
    expect(observedCorrelationId).toBe(runID);

    const ended = await server.callTool("end_tool_session", { sessionId });
    expect(ended.structuredContent).toEqual({ sessionId, ended: true });
    expect(toolSessions.activeCount()).toBe(0);
  });
});
