import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition, SkillInput } from "./types.js";
import { executeSkill } from "./executor.js";
import { userPrompt } from "../shared/prompt.js";
import { ok, errUpstream } from "../shared/result.js";
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

function generatePromptText(skill: SkillDefinition, args: Record<string, unknown> = {}): string {
  const lines = [`Execute the following workflow "${skill.title}" using AirMCP tools:`];
  // When the prompt was called with arguments, surface them so the LLM
  // knows which inputs are already bound and doesn't re-ask. Keys are
  // displayed in declaration order (Object.entries is stable).
  if (Object.keys(args).length > 0) {
    lines.push("", "Inputs:");
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined) continue;
      lines.push(`  ${k} = ${JSON.stringify(v)}`);
    }
  }
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

/**
 * Convert skill `inputs` to a prompt-argument schema. MCP prompt arguments
 * carry no type information on the wire — every value arrives as a string.
 * We map each input to a `z.string()` with `.describe()` / `.optional()`
 * so the client UI renders the right hint, but the skill executor never
 * sees these values (prompt registration just generates the prompt text).
 */
function buildPromptArgsSchema(inputs: Record<string, SkillInput>): Record<string, z.ZodTypeAny> {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(inputs)) {
    let field: z.ZodString = z.string();
    if (spec.description) field = field.describe(spec.description);
    out[name] = spec.required ? field : field.optional();
  }
  return out;
}

function registerAsPrompt(server: McpServer, skill: SkillDefinition): void {
  if (skill.inputs && Object.keys(skill.inputs).length > 0) {
    // Modern path — typed argsSchema exposed to the client, plus the
    // generated prompt text includes the bound values as an `Inputs:`
    // block so the LLM picks them up.
    const argsSchema = buildPromptArgsSchema(skill.inputs);
    server.registerPrompt(
      skill.name,
      { title: skill.title, description: skill.description, argsSchema },
      (args: Record<string, unknown> = {}) => userPrompt(skill.description, generatePromptText(skill, args)),
    );
    return;
  }
  // Legacy path — no inputs, keep the existing single-line registration
  // so nothing in the wire format changes for built-ins that don't need
  // arguments yet.
  server.prompt(skill.name, skill.description, () => userPrompt(skill.description, generatePromptText(skill)));
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
          return errUpstream(`Skill "${skill.name}" failed at step "${failedStep?.id}": ${failedStep?.error}`);
        }
        return ok(result);
      } catch (e) {
        return errUpstream(`Skill "${skill.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
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
