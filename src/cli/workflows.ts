/**
 * `npx airmcp workflows` — curated high-value workflow catalog.
 */
import { readFileSync } from "node:fs";
import { BOLD, CYAN, DIM, GREEN, RESET, WHITE } from "./style.js";

type Workflow = {
  id: string;
  title: string;
  bestFor: string;
  prompt: string;
  siri?: string;
  tools: string[];
  requiredModules: string[];
  implementation: "prompt-recipe" | "built-in-skill";
  safety: string;
};

const workflowCatalog = JSON.parse(
  readFileSync(new URL("./workflows-catalog.json", import.meta.url), "utf8"),
) as Workflow[];

export const WORKFLOWS: Workflow[] = workflowCatalog;

const DAILY_BRIEFING_PREVIEW_MODULES = new Set(["calendar", "reminders", "mail", "notes"]);

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function workflowId(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("--"));
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

async function printReadOnlyPreview(workflow: Workflow): Promise<void> {
  if (workflow.id !== "daily-briefing") {
    console.error(`Read-only preview is currently available only for "daily-briefing".`);
    process.exitCode = 1;
    return;
  }

  const { buildSnapshot } = await import("../shared/resources.js");
  const snapshot = await buildSnapshot((moduleName) => DAILY_BRIEFING_PREVIEW_MODULES.has(moduleName), "brief");

  console.log(`AirMCP read-only preview: ${workflow.title}`);
  console.log(`Reads: ${Array.from(DAILY_BRIEFING_PREVIEW_MODULES).join(", ")}`);
  console.log(`Writes: none`);
  console.log("");
  console.log(snapshot);
}

export async function runWorkflows(args = process.argv.slice(3)): Promise<void> {
  const id = workflowId(args);
  const workflow = findWorkflow(args);

  if (id && !workflow) {
    console.error(`Unknown workflow "${id}". Run "npx airmcp workflows" to list available workflows.`);
    process.exitCode = 1;
    return;
  }

  if (hasFlag(args, "--preview")) {
    if (!workflow) {
      console.error(`Choose a workflow id, for example: npx airmcp workflows daily-briefing --preview`);
      process.exitCode = 1;
      return;
    }
    await printReadOnlyPreview(workflow);
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
    `  ${DIM}Tip: run ${BOLD}npx airmcp workflows daily-briefing --prompt${RESET}${DIM} to print one copyable prompt.${RESET}`,
  );
  console.log("");
}
