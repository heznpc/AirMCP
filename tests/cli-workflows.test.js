import { describe, test, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";

const mockBuildSnapshot = jest.fn();
const mockCollectTodayOverviewDiagnostic = jest.fn();
jest.unstable_mockModule("../dist/shared/resources.js", () => ({
  buildSnapshot: mockBuildSnapshot,
}));
jest.unstable_mockModule("../dist/shared/workflow-diagnostics.js", () => ({
  collectTodayOverviewDiagnostic: mockCollectTodayOverviewDiagnostic,
}));

const { WORKFLOWS, runWorkflows } = await import("../dist/cli/workflows.js");
const { MODULE_NAMES, MODULE_PACK_MANIFEST, STARTER_MODULES } = await import("../dist/shared/config.js");
const { PATHS } = await import("../dist/shared/constants.js");
const originalAirMcpProfile = process.env.AIRMCP_PROFILE;
const originalConfigPath = PATHS.CONFIG;

describe("cli workflows command", () => {
  let logSpy;
  let errSpy;

  beforeEach(() => {
    mockBuildSnapshot.mockReset();
    mockCollectTodayOverviewDiagnostic.mockReset();
    PATHS.CONFIG = "/tmp/__airmcp_cli_workflows_test_nonexistent_config__.json";
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = undefined;
    if (originalAirMcpProfile === undefined) delete process.env.AIRMCP_PROFILE;
    else process.env.AIRMCP_PROFILE = originalAirMcpProfile;
    PATHS.CONFIG = originalConfigPath;
  });

  test("prints curated workflow names and prompts", async () => {
    await runWorkflows([]);

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("AirMCP Workflows");
    expect(output).toContain("Daily Briefing");
    expect(output).toContain("Inbox Triage");
    expect(output).toContain("Project Digest");
    expect(output).toContain("triage my inbox");
  });

  test("emits machine-readable JSON catalog", async () => {
    await runWorkflows(["--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.workflows).toHaveLength(WORKFLOWS.length);
    expect(parsed.workflows.map((w) => w.id)).toEqual([
      "today-overview",
      "daily-briefing",
      "inbox-triage",
      "meeting-prep",
      "project-digest",
      "focus-blocks",
      "research-output",
    ]);
  });

  test("prints one copyable workflow prompt", async () => {
    await runWorkflows(["today-overview", "--prompt"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe(
      "Tell me today's calendar events and overdue reminders. Do not change anything.",
    );
  });

  test("emits machine-readable JSON for one workflow", async () => {
    await runWorkflows(["project-digest", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.workflow).toMatchObject({
      id: "project-digest",
      title: "Project Digest",
      requiredModules: ["memory", "notes", "calendar", "reminders", "mail", "finder"],
      implementation: "built-in-skill",
    });
  });

  test("prints one workflow module list", async () => {
    await runWorkflows(["meeting-prep", "--modules"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe("calendar, notes, contacts, finder, reminders");
  });

  test("prints workflow readiness from the same catalog", async () => {
    await runWorkflows(["daily-briefing", "--readiness"]);

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Workflow config readiness");
    expect(output).toContain("MCP workflow_readiness");
    expect(output).toContain("Daily Briefing");
    expect(output).toContain("daily-briefing");
    expect(output).toMatch(/ready|partial|blocked/);
  });

  test("emits machine-readable workflow readiness JSON", async () => {
    await runWorkflows(["daily-briefing", "--readiness", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      scope: "config",
      summary: { total: 1 },
    });
    expect(parsed.note).toContain("workflow_readiness");
    expect(parsed.workflows[0].id).toBe("daily-briefing");
  });

  test("labels the daily briefing preview as a direct-local diagnostic outside MCP governance", async () => {
    process.env.AIRMCP_PROFILE = "communications-safe";
    mockBuildSnapshot.mockResolvedValue('{"timestamp":"2026-06-17T00:00:00.000Z","depth":"brief","calendar":{}}');

    await runWorkflows(["daily-briefing", "--preview"]);

    expect(mockBuildSnapshot).toHaveBeenCalledTimes(1);
    const enabled = mockBuildSnapshot.mock.calls[0][0];
    expect(enabled("calendar")).toBe(true);
    expect(enabled("reminders")).toBe(true);
    expect(enabled("mail")).toBe(true);
    expect(enabled("notes")).toBe(true);
    expect(enabled("weather")).toBe(false);

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("AirMCP local diagnostic preview: Daily Briefing");
    expect(output).toContain("Governance: bypassed");
    expect(output).toContain("creates no AirMCP audit entry");
    expect(output).toContain("paste it into a connected MCP client");
    expect(output).toContain("Writes: none");
    expect(output).toContain('"depth":"brief"');
  });

  test("uses the dedicated bounded today overview diagnostic collector", async () => {
    process.env.AIRMCP_PROFILE = "starter";
    mockCollectTodayOverviewDiagnostic.mockResolvedValue({
      timestamp: "2026-06-17T00:00:00.000Z",
      workflowId: "today-overview",
      calendar: { returned: 0, events: [] },
      reminders: { returned: 0, overdue: [] },
    });

    await runWorkflows(["today-overview", "--preview"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockCollectTodayOverviewDiagnostic).toHaveBeenCalledTimes(1);
    expect(mockBuildSnapshot).not.toHaveBeenCalled();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("AirMCP local diagnostic preview: Today Overview");
    expect(output).toContain("Governance: bypassed");
    expect(output).toContain("Reads: calendar, reminders");
    expect(output).toContain("Writes: none");
    expect(output).toContain('"overdue": []');
  });

  test("blocks daily briefing preview before accessing disabled Mail", async () => {
    process.env.AIRMCP_PROFILE = "starter";

    await runWorkflows(["daily-briefing", "--preview"]);

    expect(process.exitCode).toBe(1);
    expect(mockBuildSnapshot).not.toHaveBeenCalled();
    const error = errSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(error).toContain('Cannot run the local diagnostic preview for "daily-briefing"');
    expect(error).toContain('active "starter" profile');
    expect(error).toContain('module "mail"');
    expect(error).toContain("npx airmcp init --profile communications-safe --yes");
    expect(error).toContain("workflows daily-briefing --readiness");
  });

  test("unknown flags fail instead of falling through to the catalog", async () => {
    await runWorkflows(["daily-briefing", "--promt"]);

    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown option"));
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("short help flag is accepted", async () => {
    await runWorkflows(["-h"]);

    expect(process.exitCode).toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  test("references only tools that exist in the generated manifest", () => {
    const manifest = JSON.parse(readFileSync(new URL("../docs/tool-manifest.json", import.meta.url), "utf8"));
    const toolNames = new Set(manifest.tools.map((tool) => tool.name));

    for (const workflow of WORKFLOWS) {
      for (const tool of workflow.tools) {
        expect(toolNames.has(tool)).toBe(true);
      }
    }
  });

  test("references only modules that exist in config", () => {
    const moduleNames = new Set(MODULE_NAMES);

    for (const workflow of WORKFLOWS) {
      expect(workflow.requiredModules.length).toBeGreaterThan(0);
      for (const moduleName of workflow.requiredModules) {
        expect(moduleNames.has(moduleName)).toBe(true);
      }
    }
  });

  test("keeps the workflow guide in sync with the CLI catalog", () => {
    const guide = readFileSync(new URL("../docs/workflows.md", import.meta.url), "utf8");

    for (const workflow of WORKFLOWS) {
      expect(guide).toContain(workflow.title);
      expect(guide).toContain(workflow.prompt);
      expect(guide).toContain(workflow.implementation);
      for (const moduleName of workflow.requiredModules) {
        expect(guide).toContain(`\`${moduleName}\``);
      }
    }

    expect(guide).toContain("AIRMCP_ENABLE_FOUNDATION_MODELS");
  });

  test("documents the actual starter module preset", () => {
    const mcpb = readFileSync(new URL("../docs/mcpb.md", import.meta.url), "utf8");

    for (const moduleName of STARTER_MODULES) {
      expect(mcpb).toContain(moduleName);
    }
    expect(mcpb).not.toContain("contacts, mail, finder, system");
  });

  test("keeps onboarding workflow cards aligned with the CLI catalog", () => {
    const appCatalog = readFileSync(
      new URL("../app/Sources/AirMCPApp/Generated/AppCatalog.swift", import.meta.url),
      "utf8",
    );

    for (const workflow of WORKFLOWS) {
      expect(appCatalog).toContain(`id: "${workflow.id}"`);
      const camelId = workflow.id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      expect(appCatalog).toContain(`promptKey: "workflow.${camelId}.prompt"`);
      for (const moduleName of workflow.requiredModules) {
        expect(appCatalog).toContain(`"${moduleName}"`);
      }
    }
  });

  test("keeps menubar workflow tools aligned with the CLI catalog", () => {
    const appCatalog = readFileSync(
      new URL("../app/Sources/AirMCPApp/Generated/AppCatalog.swift", import.meta.url),
      "utf8",
    );

    function menuToolsFor(id) {
      const match = appCatalog.match(new RegExp(`WorkflowInfo\\(\\s*id: "${id}"[\\s\\S]*?tools: \\[([^\\]]*)\\]`));
      expect(match).not.toBeNull();
      return [...match[1].matchAll(/"([^"]+)"/g)].map((tool) => tool[1]);
    }

    for (const workflow of WORKFLOWS) {
      expect(menuToolsFor(workflow.id)).toEqual(workflow.tools);
    }
  });

  test("keeps generated app module packs aligned with the runtime manifest", () => {
    const appCatalog = readFileSync(
      new URL("../app/Sources/AirMCPApp/Generated/AppCatalog.swift", import.meta.url),
      "utf8",
    );
    const appPackIds = [...appCatalog.matchAll(/ModulePackInfo\(\s*id: "([^"]+)"/g)].map((match) => match[1]);

    expect(appPackIds).toEqual(MODULE_PACK_MANIFEST.map((pack) => pack.name));
    for (const pack of MODULE_PACK_MANIFEST) {
      expect(appCatalog).toContain(`packageName: "${pack.packageName}"`);
    }
  });

  test("built-in workflow catalog entries point at checked-in skill definitions", () => {
    const builtinsDir = new URL("../src/skills/builtins/", import.meta.url);

    for (const workflow of WORKFLOWS) {
      const skillTools = workflow.tools.filter((tool) => tool.startsWith("skill_"));
      if (workflow.implementation === "built-in-skill") {
        expect(skillTools.length).toBeGreaterThan(0);
      }
      for (const tool of skillTools) {
        const skillId = tool.replace(/^skill_/, "");
        expect(existsSync(new URL(`${skillId}.yaml`, builtinsDir))).toBe(true);
      }
    }
  });

  test("onboarding exposes Codex CLI setup", () => {
    const onboarding = readFileSync(
      new URL("../app/Sources/AirMCPApp/Views/OnboardingView.swift", import.meta.url),
      "utf8",
    );
    const codexConfigurator = readFileSync(
      new URL("../app/Sources/AirMCPApp/CodexOnboardingConfigurator.swift", import.meta.url),
      "utf8",
    );

    expect(onboarding).toContain('id: "codex"');
    expect(onboarding).toContain('NodeEnvironment.findExecutable(named: "codex")');
    expect(onboarding).toContain("CodexOnboardingConfigurator.configure(");
    expect(codexConfigurator).toContain('["mcp", "get", "airmcp", "--json"]');
    expect(codexConfigurator).toContain('["mcp", "remove", "airmcp"]');
    expect(codexConfigurator).toContain('var addArguments = ["mcp", "add"]');
    expect(codexConfigurator).toContain('replacementEnvironment["AIRMCP_HTTP_TOKEN"] = token');
    expect(codexConfigurator).toContain("ConfigSnapshot.capture(at: configURL)");
    expect(codexConfigurator).toContain("snapshot.containsAirMCPServerEntry");
    expect(codexConfigurator).toContain("snapshot.restore(at: configURL)");
    expect(codexConfigurator).toContain("process.currentDirectoryURL = currentDirectory");
    expect(codexConfigurator).toContain('environment.removeValue(forKey: "CODEX_HOME")');
    expect(onboarding).toContain("AirMcpConstants.appOwnedProxyArgs");
    expect(onboarding).toContain("AirMcpConstants.appOwnedProxyEntry(token: token)");
    expect(onboarding).toContain('path + ".airmcp-backup"');
    expect(onboarding).toContain("A malformed existing file is");
  });

  test("onboarding final step keeps the first success read-only", () => {
    const onboarding = readFileSync(
      new URL("../app/Sources/AirMCPApp/Views/OnboardingView.swift", import.meta.url),
      "utf8",
    );

    expect(onboarding).toContain("firstSuccessActions");
    expect(onboarding).toContain('onboardingWorkflows.first(where: { $0.id == "today-overview" })');
    expect(onboarding).toContain("AirMcpConstants.copyToClipboard(firstSuccessWorkflow.prompt)");
    expect(onboarding).not.toContain("AirMcpConstants.copyToClipboard(selectedWorkflow.prompt)");
    expect(onboarding).not.toContain('AirMcpConstants.copyToClipboard("Hey Siri, \\(siriPhrase)")');
  });
});
