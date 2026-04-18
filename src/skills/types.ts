import { z } from "zod";

export const SkillStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Step ID must be lowercase alphanumeric with underscores"),
  tool: z.string().min(1, "Tool name is required"),
  args: z.record(z.unknown()).optional(),
  only_if: z.string().optional(),
  skip_if: z.string().optional(),
  parallel: z.boolean().optional(),
  loop: z.string().optional(),
});

export const SkillDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Skill name must be kebab-case"),
  title: z.string().min(1),
  description: z.string().min(1),
  expose_as: z.enum(["prompt", "tool"]),
  trigger: z
    .object({
      event: z.enum([
        "calendar_changed",
        "reminders_changed",
        "pasteboard_changed",
        "mail_unread_changed",
        "focus_mode_changed",
        "now_playing_changed",
        "file_modified",
      ]),
      debounce_ms: z.number().optional(),
    })
    .optional(),
  steps: z.array(SkillStepSchema).min(1, "At least one step required"),
});

export type SkillStep = z.infer<typeof SkillStepSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

export interface StepResult {
  id: string;
  status: "ok" | "skipped" | "error";
  data?: unknown;
  error?: string;
}

export interface SkillResult {
  skill: string;
  steps: StepResult[];
  success: boolean;
}
