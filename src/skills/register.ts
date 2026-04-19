import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition, SkillInput } from "./types.js";
import { executeSkill } from "./executor.js";
import { userPrompt } from "../shared/prompt.js";
import { ok, err } from "../shared/result.js";
import { toolRegistry } from "../shared/tool-registry.js";
import { z } from "zod";

/**
 * Convert a skill's declared `inputs` into a Zod `inputSchema` record that
 * `server.registerTool` accepts. Mirrors the MCP convention:
 *   - `required: true`      → non-optional Zod field
 *   - `default: <value>`    → `.default(value)` (implicitly optional)
 *   - otherwise             → `.optional()`
 */
function buildSkillInputSchema(inputs: Record<string, SkillInput>): Record<string, z.ZodTypeAny> {
  const schema: Record<string, z.ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(inputs)) {
    // Build + finalise each branch independently so TypeScript keeps the
    // narrowed string|number|boolean type when applying `.default()` —
    // calling `.default()` on a `ZodString | ZodNumber | ZodBoolean`
    // union is not valid because the overload signatures diverge per
    // member, so we resolve the default before widening to ZodTypeAny.
    let field: z.ZodTypeAny;
    switch (spec.type) {
      case "string": {
        let f = z.string();
        if (spec.description) f = f.describe(spec.description);
        if (spec.default !== undefined) {
          field = f.default(spec.default as string);
        } else if (!spec.required) {
          field = f.optional();
        } else {
          field = f;
        }
        break;
      }
      case "number": {
        let f = z.number();
        if (spec.description) f = f.describe(spec.description);
        if (spec.default !== undefined) {
          field = f.default(spec.default as number);
        } else if (!spec.required) {
          field = f.optional();
        } else {
          field = f;
        }
        break;
      }
      case "boolean": {
        let f = z.boolean();
        if (spec.description) f = f.describe(spec.description);
        if (spec.default !== undefined) {
          field = f.default(spec.default as boolean);
        } else if (!spec.required) {
          field = f.optional();
        } else {
          field = f;
        }
        break;
      }
    }
    schema[name] = field;
  }
  return schema;
}

function generatePromptText(skill: SkillDefinition): string {
  const lines = [`Execute the following workflow "${skill.title}" using AirMCP tools:`];
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i]!;
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
  const inputSchema = skill.inputs ? buildSkillInputSchema(skill.inputs) : {};
  server.registerTool(
    `skill_${skill.name}`,
    {
      title: skill.title,
      description: `[Skill] ${skill.description}`,
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown> = {}) => {
      try {
        const result = await executeSkill(server, skill, args);
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

/**
 * Graceful pre-flight check: if the name is already registered (e.g. a
 * built-in prompt/tool in another module beat us to it), log a warning and
 * skip this skill instead of letting the MCP SDK throw and take the whole
 * server down.
 *
 * This is the runtime counterpart to tests/skill-name-collision.test.js —
 * the test catches the issue pre-publish; this guard ensures that even if
 * a collision slips through, the process degrades gracefully instead of
 * crashing on startup (see v2.8.0 "Prompt weekly-review is already
 * registered" incident).
 */
function isPromptNameTaken(name: string): boolean {
  return toolRegistry.getPromptNames().includes(name);
}

function isToolNameTaken(name: string): boolean {
  return toolRegistry.getToolNames().includes(name);
}

export function registerSkills(
  server: McpServer,
  skills: SkillDefinition[],
): { prompts: number; tools: number; skipped: number } {
  let prompts = 0;
  let tools = 0;
  let skipped = 0;
  for (const skill of skills) {
    switch (skill.expose_as) {
      case "prompt": {
        if (isPromptNameTaken(skill.name)) {
          console.error(
            `[AirMCP] Skill "${skill.name}" collides with an already-registered prompt — skipping. ` +
              `Rename the skill in its YAML to resolve.`,
          );
          skipped++;
          break;
        }
        registerAsPrompt(server, skill);
        prompts++;
        break;
      }
      case "tool": {
        const toolName = `skill_${skill.name}`;
        if (isToolNameTaken(toolName)) {
          console.error(
            `[AirMCP] Skill "${skill.name}" collides with an already-registered tool "${toolName}" — skipping. ` +
              `Rename the skill in its YAML to resolve.`,
          );
          skipped++;
          break;
        }
        registerAsTool(server, skill);
        tools++;
        break;
      }
    }
  }
  return { prompts, tools, skipped };
}
