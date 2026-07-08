import { describe, test, expect } from "@jest/globals";

const { WORKFLOWS, assessWorkflowReadiness, assessWorkflowsReadiness, findWorkflow } = await import(
  "../dist/shared/workflows.js"
);

describe("workflow readiness", () => {
  test("marks a workflow ready when modules and tools are available", () => {
    const workflow = findWorkflow("daily-briefing");

    const result = assessWorkflowReadiness(workflow, {
      enabledModules: workflow.requiredModules,
      registeredTools: workflow.tools,
      allowSendMail: false,
    });

    expect(result).toMatchObject({
      id: "daily-briefing",
      status: "ready",
      ready: true,
      issues: [],
    });
  });

  test("reports inactive add-on packs with install commands", () => {
    const workflow = findWorkflow("meeting-prep");

    const result = assessWorkflowReadiness(workflow, {
      enabledModules: ["calendar", "notes", "finder", "reminders"],
      modulesMissingPacks: ["contacts"],
      registeredTools: workflow.tools,
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "module_pack_unavailable",
        module: "contacts",
        pack: "communications",
        command: "npx airmcp modules enable communications --install",
      }),
    );
  });

  test("reports disabled modules with a profile command", () => {
    const workflow = findWorkflow("daily-briefing");

    const result = assessWorkflowReadiness(workflow, {
      enabledModules: ["calendar", "reminders", "notes"],
      registeredTools: workflow.tools,
    });

    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("runtime item");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "module_disabled",
        module: "mail",
        command: "npx airmcp init --profile full --yes",
      }),
    );
  });

  test("labels config-only readiness when tool registration is not checked", () => {
    const workflow = findWorkflow("daily-briefing");

    const result = assessWorkflowReadiness(workflow, {
      enabledModules: workflow.requiredModules,
    });

    expect(result.status).toBe("ready");
    expect(result.summary).toContain("tool registration was not checked");
  });

  test("treats disabled write opt-ins as partial readiness", () => {
    const workflow = findWorkflow("research-output");

    const result = assessWorkflowReadiness(workflow, {
      enabledModules: workflow.requiredModules,
      registeredTools: workflow.tools,
      allowSendMail: false,
    });

    expect(result.status).toBe("partial");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "write_opt_in_disabled",
        severity: "warning",
        tool: "send_mail",
      }),
    );
  });

  test("assesses every catalog workflow", () => {
    const results = assessWorkflowsReadiness({
      enabledModules: WORKFLOWS.flatMap((workflow) => workflow.requiredModules),
      registeredTools: WORKFLOWS.flatMap((workflow) => workflow.tools),
      allowSendMail: true,
    });

    expect(results).toHaveLength(WORKFLOWS.length);
    expect(results.every((result) => result.status === "ready")).toBe(true);
  });
});
