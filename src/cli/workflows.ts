/**
 * `npx airmcp workflows` — curated high-value workflow catalog.
 */
import { BOLD, CYAN, DIM, GREEN, RESET, WHITE } from "./style.js";
import { parseConfig, isModuleEnabled } from "../shared/config.js";
import { getModulePackPlan } from "../shared/modules.js";
import { getMissingAddonPackageModules } from "../shared/module-loader.js";
import {
  WORKFLOWS,
  assessWorkflowReadiness,
  assessWorkflowsReadiness,
  summarizeWorkflowsReadiness,
  type Workflow,
} from "../shared/workflows.js";

export { WORKFLOWS };

const READ_ONLY_PREVIEW_WORKFLOW_IDS = new Set(["today-overview", "daily-briefing"]);
const KNOWN_FLAGS = new Set([
  "--json",
  "--prompt",
  "--siri",
  "--tools",
  "--modules",
  "--safety",
  "--preview",
  "--readiness",
  "--help",
  "-h",
]);

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function workflowId(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-"));
}

function unknownFlags(args: string[]): string[] {
  return args.filter((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg));
}

function findWorkflow(args: string[]): Workflow | undefined {
  const id = workflowId(args);
  if (!id) return undefined;
  return WORKFLOWS.find((workflow) => workflow.id === id);
}

function printWorkflowField(workflow: Workflow, args: string[]): boolean {
  if (hasFlag(args, "--prompt")) {
    console.log(workflow.prompt);
    return true;
  }
  if (hasFlag(args, "--siri")) {
    console.log(workflow.siri ? `Hey Siri, ${workflow.siri}` : "");
    return true;
  }
  if (hasFlag(args, "--tools")) {
    console.log(workflow.tools.join(", "));
    return true;
  }
  if (hasFlag(args, "--modules")) {
    console.log(workflow.requiredModules.join(", "));
    return true;
  }
  if (hasFlag(args, "--safety")) {
    console.log(workflow.safety);
    return true;
  }
  return false;
}

async function printLocalDiagnosticPreview(workflow: Workflow): Promise<void> {
  if (!READ_ONLY_PREVIEW_WORKFLOW_IDS.has(workflow.id)) {
    console.error(`Local diagnostic preview is available for "today-overview" and "daily-briefing".`);
    process.exitCode = 1;
    return;
  }

  const config = parseConfig();
  const packPlan = getModulePackPlan(config);
  const readiness = assessWorkflowReadiness(workflow, {
    enabledModules: workflow.requiredModules.filter((moduleName) => isModuleEnabled(config, moduleName)),
    modulesMissingPacks: packPlan.modulesMissingPacks,
    modulesMissingAddonPackages: getMissingAddonPackageModules(),
    allowSendMail: config.allowSendMail,
    allowSendMessages: config.allowSendMessages,
  });

  if (!readiness.ready) {
    console.error(
      `Cannot run the local diagnostic preview for "${workflow.id}" with the active "${config.profile}" profile.`,
    );
    for (const issue of readiness.issues) {
      const target = issue.module ?? issue.tool ?? issue.pack ?? issue.code;
      console.error(`- ${target}: ${issue.message}`);
      if (issue.command) console.error(`  Try: ${issue.command}`);
    }
    console.error(`Run "npx airmcp workflows ${workflow.id} --readiness" for the complete readiness report.`);
    process.exitCode = 1;
    return;
  }

  console.log(`AirMCP local diagnostic preview: ${workflow.title}`);
  console.log(`Governance: bypassed — this is not an MCP call and creates no AirMCP audit entry`);
  console.log(`Reads: ${workflow.requiredModules.join(", ")}`);
  console.log(`Writes: none`);
  console.log(`Governed run: print --prompt and paste it into a connected MCP client`);
  console.log("");

  let snapshot: string;
  if (workflow.id === "today-overview") {
    const { collectTodayOverviewDiagnostic } = await import("../shared/workflow-diagnostics.js");
    snapshot = JSON.stringify(await collectTodayOverviewDiagnostic(), null, 2);
  } else {
    const previewModules = new Set(workflow.requiredModules);
    const { buildSnapshot } = await import("../shared/resources.js");
    snapshot = await buildSnapshot(
      (moduleName) => previewModules.has(moduleName) && isModuleEnabled(config, moduleName),
      "brief",
    );
  }

  console.log(snapshot);
}

async function printReadiness(workflow: Workflow | undefined, json = false): Promise<void> {
  const config = parseConfig();
  const enabledModules = Array.from(new Set(WORKFLOWS.flatMap((w) => w.requiredModules))).filter((moduleName) =>
    isModuleEnabled(config, moduleName),
  );
  const packPlan = getModulePackPlan(config);
  const readiness = assessWorkflowsReadiness({
    enabledModules,
    modulesMissingPacks: packPlan.modulesMissingPacks,
    modulesMissingAddonPackages: getMissingAddonPackageModules(),
    allowSendMail: config.allowSendMail,
    allowSendMessages: config.allowSendMessages,
  });
  const rows = workflow ? readiness.filter((row) => row.id === workflow.id) : readiness;

  if (json) {
    console.log(
      JSON.stringify(
        {
          scope: "config",
          note: "Checks profile, module packs, add-on packages, and write opt-ins. Live tool registration is checked by the MCP workflow_readiness tool.",
          summary: summarizeWorkflowsReadiness(rows),
          workflows: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`${BOLD}${WHITE}Workflow config readiness${RESET}`);
  console.log(
    `${DIM}Checks profile, module packs, add-on packages, and write opt-ins. Use MCP workflow_readiness for live tool registration.${RESET}`,
  );
  console.log("");

  for (const row of rows) {
    const color = row.status === "ready" ? GREEN : row.status === "partial" ? CYAN : WHITE;
    console.log(`${color}${row.title}${RESET} (${row.id}) — ${row.status}`);
    console.log(`  ${DIM}${row.summary}${RESET}`);
    if (row.issues.length > 0) {
      for (const issue of row.issues) {
        const target = issue.module ?? issue.tool ?? issue.pack ?? issue.code;
        console.log(`  ${issue.severity}: ${target} — ${issue.message}`);
        if (issue.command) console.log(`    ${DIM}${issue.command}${RESET}`);
      }
    }
  }
}

export async function runWorkflows(args = process.argv.slice(3)): Promise<void> {
  const invalidFlags = unknownFlags(args);
  if (invalidFlags.length > 0) {
    console.error(`Unknown option${invalidFlags.length === 1 ? "" : "s"}: ${invalidFlags.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const id = workflowId(args);
  const workflow = findWorkflow(args);

  if (id && !workflow) {
    console.error(`Unknown workflow "${id}". Run "npx airmcp workflows" to list available workflows.`);
    process.exitCode = 1;
    return;
  }

  if (hasFlag(args, "--preview")) {
    if (!workflow) {
      console.error(`Choose a workflow id, for example: npx airmcp workflows today-overview --preview`);
      process.exitCode = 1;
      return;
    }
    await printLocalDiagnosticPreview(workflow);
    return;
  }

  if (hasFlag(args, "--readiness")) {
    await printReadiness(workflow, hasFlag(args, "--json"));
    return;
  }

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(workflow ? { workflow } : { workflows: WORKFLOWS }, null, 2));
    return;
  }

  if (workflow && printWorkflowField(workflow, args)) {
    return;
  }

  console.log("");
  console.log(`  ${BOLD}${WHITE}AirMCP Workflows${RESET}`);
  console.log(`  ${DIM}High-value Apple workspace workflows for MCP clients, Siri, and Shortcuts.${RESET}`);
  console.log("");

  const workflows = workflow ? [workflow] : WORKFLOWS;

  for (const [idx, workflow] of workflows.entries()) {
    console.log(`  ${CYAN}${idx + 1}. ${workflow.title}${RESET}`);
    console.log(`     ${DIM}${workflow.bestFor}${RESET}`);
    console.log(`     ${GREEN}Try:${RESET} "${workflow.prompt}"`);
    if (workflow.siri) {
      console.log(`     ${GREEN}Siri:${RESET} "Hey Siri, ${workflow.siri}"`);
    }
    console.log(`     ${GREEN}Tools:${RESET} ${workflow.tools.join(", ")}`);
    console.log(`     ${GREEN}Modules:${RESET} ${workflow.requiredModules.join(", ")}`);
    console.log(`     ${GREEN}Type:${RESET} ${workflow.implementation}`);
    console.log(`     ${GREEN}Safety:${RESET} ${workflow.safety}`);
    console.log("");
  }

  console.log(
    `  ${DIM}Tip: run ${BOLD}npx airmcp workflows --json${RESET}${DIM} to reuse this catalog in docs or apps.${RESET}`,
  );
  console.log(
    `  ${DIM}Tip: run ${BOLD}npx airmcp workflows today-overview --prompt${RESET}${DIM} to print the starter-safe first prompt.${RESET}`,
  );
  console.log(
    `  ${DIM}Tip: run ${BOLD}npx airmcp workflows --readiness${RESET}${DIM} to check profile/add-on readiness before launching a workflow.${RESET}`,
  );
  console.log("");
}
