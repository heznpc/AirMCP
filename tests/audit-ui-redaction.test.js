/** UI input values must be removed before a row is sealed into the HMAC audit
 * chain. These tests inspect the actual JSONL bytes as well as the verified
 * public history so a read-time-only redaction cannot satisfy the regression. */
import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockServer } from "./helpers/mock-server.js";
import { createMockConfig } from "./helpers/mock-config.js";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-audit-ui-redaction-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "audit-ui-redaction-key";
process.env.AIRMCP_AUDIT_LOG = "true";
process.env.AIRMCP_USAGE_TRACKING = "false";
process.env.AIRMCP_EMERGENCY_STOP_PATH = join(workDir, "emergency-stop");

const audit = await import("../dist/shared/audit.js");
const auditPath = join(workDir, "audit.jsonl");

async function writeRows(entries) {
  for (const entry of entries) {
    audit.auditLog({ timestamp: new Date().toISOString(), status: "ok", ...entry });
  }
  await audit._testFlush();
  const raw = await readFile(auditPath, "utf8");
  return {
    raw,
    rows: raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}

beforeEach(() => audit._testReset());

afterAll(async () => {
  audit._testReset();
  await rm(workDir, { recursive: true, force: true });
});

describe("UI-input audit redaction", () => {
  test("redacts sensitive UI values before sealing while preserving benign context", async () => {
    const secrets = {
      typeText: "TYPE-SECRET-hunter2",
      clickText: "CLICK-SECRET-account-name",
      pressKey: "PRESS-KEY-SECRET",
      queryTitle: "QUERY-TITLE-SECRET",
      queryValue: "QUERY-VALUE-SECRET",
      queryDescription: "QUERY-DESCRIPTION-SECRET",
      queryLabel: "QUERY-LABEL-SECRET",
      actionTitle: "ACTION-TITLE-SECRET",
      actionValueLocator: "ACTION-LOCATOR-VALUE-SECRET",
      actionDescription: "ACTION-DESCRIPTION-SECRET",
      actionLabel: "ACTION-LABEL-SECRET",
      actionInput: "ACTION-INPUT-SECRET",
      beforeSnapshot: "SNAPSHOT-SECRET-1234",
    };
    const { raw, rows } = await writeRows([
      { tool: "ui_type", args: { text: secrets.typeText, appName: "Notes" } },
      {
        tool: "ui_click",
        args: { text: secrets.clickText, appName: "Safari", x: 42, y: 84, role: "AXButton", index: 2 },
      },
      {
        tool: "ui_press_key",
        args: { key: secrets.pressKey, modifiers: ["command", "shift"], appName: "Notes" },
      },
      {
        tool: "ui_accessibility_query",
        args: {
          app: "Safari",
          role: "AXTextField",
          title: secrets.queryTitle,
          value: secrets.queryValue,
          description: secrets.queryDescription,
          label: secrets.queryLabel,
          identifier: "account-field",
          maxResults: 5,
        },
      },
      {
        tool: "ui_perform_action",
        args: {
          app: "Notes",
          role: "AXTextField",
          title: secrets.actionTitle,
          value: secrets.actionValueLocator,
          description: secrets.actionDescription,
          label: secrets.actionLabel,
          identifier: "body-field",
          action: "setValue",
          actionValue: secrets.actionInput,
          index: 1,
        },
      },
      {
        tool: "ui_diff",
        args: { beforeSnapshot: secrets.beforeSnapshot, app: "Notes" },
      },
    ]);

    for (const secret of Object.values(secrets)) expect(raw).not.toContain(secret);

    const byTool = Object.fromEntries(rows.map((row) => [row.tool, row]));
    expect(byTool.ui_type.args).toEqual({
      text: { _redacted: "ui_input", length: secrets.typeText.length },
      appName: "Notes",
    });
    expect(byTool.ui_click.args).toEqual({
      text: { _redacted: "ui_input", length: secrets.clickText.length },
      appName: "Safari",
      x: 42,
      y: 84,
      role: "AXButton",
      index: 2,
    });
    expect(byTool.ui_press_key.args).toEqual({
      key: { _redacted: "ui_input", length: secrets.pressKey.length },
      modifiers: ["command", "shift"],
      appName: "Notes",
    });
    expect(byTool.ui_accessibility_query.args).toEqual({
      app: "Safari",
      role: "AXTextField",
      title: { _redacted: "ui_input", length: secrets.queryTitle.length },
      value: { _redacted: "ui_input", length: secrets.queryValue.length },
      description: { _redacted: "ui_input", length: secrets.queryDescription.length },
      label: { _redacted: "ui_input", length: secrets.queryLabel.length },
      identifier: "account-field",
      maxResults: 5,
    });
    expect(byTool.ui_perform_action.args).toEqual({
      app: "Notes",
      role: "AXTextField",
      title: { _redacted: "ui_input", length: secrets.actionTitle.length },
      value: { _redacted: "ui_input", length: secrets.actionValueLocator.length },
      description: { _redacted: "ui_input", length: secrets.actionDescription.length },
      label: { _redacted: "ui_input", length: secrets.actionLabel.length },
      identifier: "body-field",
      action: "setValue",
      actionValue: { _redacted: "ui_input", length: secrets.actionInput.length },
      index: 1,
    });
    expect(byTool.ui_diff.args).toEqual({
      beforeSnapshot: { _redacted: "ui_input", length: secrets.beforeSnapshot.length },
      app: "Notes",
    });

    for (const row of rows) {
      expect(row._prev).toMatch(/^[0-9a-f]{64}$/);
      expect(row._hmac).toMatch(/^[0-9a-f]{64}$/);
    }
    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(6);
  });

  test("does not redact the same generic key on unrelated tools", async () => {
    const { rows } = await writeRows([{ tool: "create_note", args: { title: "Groceries", text: "milk and eggs" } }]);
    expect(rows.at(-1).args).toEqual({ title: "Groceries", text: "milk and eggs" });
  });

  test("preview_action redacts its response and nested sealed rows with the same policy", async () => {
    const { createToolRegistry } = await import("../dist/shared/tool-registry.js");
    const { registerFrontDoorTools } = await import("../dist/server/front-door-tools.js");
    const server = createMockServer();
    const registry = createToolRegistry();
    registry.installOn(server);
    const targetHandler = jest.fn(async () => ({ content: [] }));

    const cases = [
      {
        tool: "ui_type",
        args: { text: "PREVIEW-TYPE-SECRET", appName: "Notes" },
        expected: { text: { _redacted: "ui_input", length: 19 }, appName: "Notes" },
      },
      {
        tool: "ui_click",
        args: { text: "PREVIEW-CLICK-SECRET", appName: "Safari", role: "AXButton", index: 3 },
        expected: {
          text: { _redacted: "ui_input", length: 20 },
          appName: "Safari",
          role: "AXButton",
          index: 3,
        },
      },
      {
        tool: "ui_press_key",
        args: { key: "PREVIEW-PRESS-KEY-SECRET", modifiers: ["command"], appName: "Notes" },
        expected: {
          key: { _redacted: "ui_input", length: 24 },
          modifiers: ["command"],
          appName: "Notes",
        },
      },
      {
        tool: "ui_accessibility_query",
        args: {
          app: "Safari",
          role: "AXTextField",
          title: "PREVIEW-QUERY-TITLE-SECRET",
          value: "PREVIEW-QUERY-VALUE-SECRET",
          description: "PREVIEW-QUERY-DESCRIPTION-SECRET",
          label: "PREVIEW-QUERY-LABEL-SECRET",
          identifier: "login-field",
        },
        expected: {
          app: "Safari",
          role: "AXTextField",
          title: { _redacted: "ui_input", length: 26 },
          value: { _redacted: "ui_input", length: 26 },
          description: { _redacted: "ui_input", length: 32 },
          label: { _redacted: "ui_input", length: 26 },
          identifier: "login-field",
        },
      },
      {
        tool: "ui_perform_action",
        args: {
          app: "Notes",
          role: "AXTextField",
          title: "PREVIEW-ACTION-TITLE-SECRET",
          value: "PREVIEW-ACTION-VALUE-SECRET",
          description: "PREVIEW-ACTION-DESCRIPTION-SECRET",
          label: "PREVIEW-ACTION-LABEL-SECRET",
          identifier: "body-field",
          action: "setValue",
          actionValue: "PREVIEW-ACTION-INPUT-SECRET",
          index: 1,
        },
        expected: {
          app: "Notes",
          role: "AXTextField",
          title: { _redacted: "ui_input", length: 27 },
          value: { _redacted: "ui_input", length: 27 },
          description: { _redacted: "ui_input", length: 33 },
          label: { _redacted: "ui_input", length: 27 },
          identifier: "body-field",
          action: "setValue",
          actionValue: { _redacted: "ui_input", length: 27 },
          index: 1,
        },
      },
      {
        tool: "ui_diff",
        args: { beforeSnapshot: "PREVIEW-SNAPSHOT-SECRET", app: "Notes" },
        expected: { beforeSnapshot: { _redacted: "ui_input", length: 23 }, app: "Notes" },
      },
    ];

    for (const { tool } of cases) {
      server.registerTool(
        tool,
        { title: tool, description: "redaction probe", inputSchema: {}, annotations: {} },
        targetHandler,
      );
    }
    const config = createMockConfig();
    registerFrontDoorTools(server, {
      toolRegistry: registry,
      config,
      harness: {
        name: "compatible",
        requireSessionForHiddenTools: false,
        maxSessionTools: 64,
        defaultSessionTtlSeconds: 900,
        maxSessionTtlSeconds: 3600,
        discoveryDescriptionMode: "summary",
      },
      version: "2.16.5-test",
      enabledModules: ["ui"],
      disabledModules: [],
      modulePacksAvailable: ["core"],
      modulePackInstallStatuses: [],
      modulePackInstallIssues: [],
      modulesMissingPacks: [],
      missingAddonPackageModules: [],
      missingPackInstallHints: [],
      buildWorkflowReadiness: () => [],
    });

    const secrets = cases.flatMap(({ args }) =>
      Object.entries(args)
        .filter(([key]) =>
          ["text", "key", "title", "value", "description", "label", "actionValue", "beforeSnapshot"].includes(key),
        )
        .map(([, value]) => value),
    );
    for (const previewCase of cases) {
      const result = await server.callTool("preview_action", { tool: previewCase.tool, args: previewCase.args });
      expect(result.structuredContent.auditPreview.args).toEqual(previewCase.expected);
      for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(targetHandler).not.toHaveBeenCalled();

    await audit._testFlush();
    const raw = await readFile(auditPath, "utf8");
    for (const secret of secrets) expect(raw).not.toContain(secret);
    const rows = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const previewRows = rows.filter((row) => row.tool === "preview_action").slice(-cases.length);
    expect(previewRows).toHaveLength(cases.length);
    for (const [index, row] of previewRows.entries()) {
      expect(row.args).toEqual({ tool: cases[index].tool, args: cases[index].expected });
      expect(row._prev).toMatch(/^[0-9a-f]{64}$/);
      expect(row._hmac).toMatch(/^[0-9a-f]{64}$/);
    }
    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
  });

  test("preview_action malformed nested args fail closed before sealing", async () => {
    const secret = "MALFORMED-PREVIEW-SECRET";
    const { raw, rows } = await writeRows([{ tool: "preview_action", args: { tool: 42, args: { text: secret } } }]);
    expect(raw).not.toContain(secret);
    expect(rows.at(-1).args).toEqual({ tool: 42, args: { _redacted: "preview_target_args" } });
    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
  });
});
