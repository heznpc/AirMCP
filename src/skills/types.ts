import { z } from "zod";

export const SkillStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Step ID must be lowercase alphanumeric with underscores"),
  tool: z.string().min(1, "Tool name is required"),
  args: z.record(z.unknown()).optional(),
  only_if: z.string().optional(),
  skip_if: z.string().optional(),
  parallel: z.boolean().optional(),
  loop: z.string().optional(),
  /**
   * Failure strategy for this step:
   *   - "abort"          (default) — stop the skill as soon as this step fails.
   *   - "continue"       — record the error, store `{ error: string }` under
   *                        the step id so later steps can reference it via
   *                        `{{stepId.error}}`, then continue.
   *   - "skip_remaining" — stop executing further steps but mark the skill
   *                        result `partial: true` with accumulated data intact.
   *
   * Inside a `loop` step, `continue` applies per-iteration — individual
   * failed iterations leave a `{ error: string }` slot in the loop result
   * array and execution moves to the next item.
   */
  on_error: z.enum(["abort", "continue", "skip_remaining"]).optional(),
  /**
   * Max retries for transient failures. Applied BEFORE `on_error` so a
   * flaky upstream (weather API, LLM timeout) gets multiple chances
   * before the policy escalates. Backoff is exponential starting at
   * `retry_backoff_ms` (default 1000) with ±25% jitter; 0 disables
   * retries. Capped at 10 so a misconfigured skill can't wedge the
   * executor.
   */
  retry: z.number().int().min(0).max(10).optional(),
  /**
   * Base backoff in ms for the first retry. Subsequent retries double
   * it (exponential). Capped at 60s so the skill doesn't silently
   * stall for minutes. Only consulted when `retry > 0`.
   */
  retry_backoff_ms: z.number().int().min(0).max(60_000).optional(),
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
        "screen_locked",
        "screen_unlocked",
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
  /** True when at least one step failed but the skill continued running
   *  because of `on_error: "continue"` or `"skip_remaining"`. Callers can
   *  use this to surface partial progress without treating the run as a
   *  hard failure. */
  partial?: boolean;
  /** IDs of steps that errored out. Empty when `success` is true. */
  failedSteps?: string[];
}
