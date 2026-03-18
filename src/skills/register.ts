import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition } from "./types.js";
import { executeSkill } from "./executor.js";
import { userPrompt } from "../shared/prompt.js";
import { ok, err } from "../shared/result.js";

function generatePromptText(skill: SkillDefinition): string {
  const lines = [`Execute the following workflow "${skill.title}" using AirMCP tools:`];
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    let line = `${i + 1}. [${step.id}] Call \`${step.tool}\``;
    if (step.args && Object.keys(step.args).length > 0) {
      line += ` with args: ${JSON.stringify(step.args)}`;
    }
    if (step.only_if) line += ` (only if ${step.only_if} is truthy)`;
    if (step.skip_if) line += ` (skip if ${step.skip_if} is truthy)`;
    lines.push(line);
  }
  lines.push("", "Execute each step in order. Pass results between steps as indicated by {{stepId.field}} templates.");
  return lines.join("\n");
}

function registerAsPrompt(server: McpServer, skill: SkillDefinition): void {
  const text = generatePromptText(skill);
  server.prompt(skill.name, skill.description, () => userPrompt(skill.description, text));
}

function registerAsTool(server: McpServer, skill: SkillDefinition): void {
  server.registerTool(
    `skill_${skill.name}`,
    {
      title: skill.title,
      description: `[Skill] ${skill.description}`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await executeSkill(server, skill);
        if (!result.success) {
          const failedStep = result.steps.find((s) => s.status === "error");
          return err(`Skill "${skill.name}" failed at step "${failedStep?.id}": ${failedStep?.error}`);
        }
        return ok(result);
      } catch (e) {
        return err(`Skill "${skill.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

export function registerSkills(
  server: McpServer,
  skills: SkillDefinition[],
): { prompts: number; tools: number } {
  let prompts = 0;
  let tools = 0;
  for (const skill of skills) {
    switch (skill.expose_as) {
      case "prompt":
        registerAsPrompt(server, skill);
        prompts++;
        break;
      case "tool":
        registerAsTool(server, skill);
        tools++;
        break;
    }
  }
  return { prompts, tools };
}
