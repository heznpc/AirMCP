import { z } from "zod";

export const SkillStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Step ID must be lowercase alphanumeric with underscores"),
  tool: z.string().min(1, "Tool name is required"),
  args: z.record(z.string(), z.unknown()).optional(),
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

/**
 * Declarative input schema for a skill. When present, an `expose_as: tool`
 * skill accepts these named arguments at call time and seeds them into the
 * template scope so steps can reference them as `{{inputName}}` — just like
 * inter-step results. Loader enforces that input names do not collide with
 * any step id.
 *
 * Supported types map directly to Zod primitives; no nested objects yet —
 * keeps the YAML ergonomic and the MCP tool schema predictable.
 */
export const SkillInputSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(500).optional(),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
});

export type SkillInput = z.infer<typeof SkillInputSchema>;

export const SkillAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    sensitiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .optional();

export const SkillDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Skill name must be kebab-case"),
  title: z.string().min(1),
  description: z.string().min(1),
  expose_as: z.enum(["prompt", "tool"]),
  /**
   * Optional named runtime inputs. Keys must be lowercase identifiers
   * (same rule as step ids) so they can be used in `{{name}}` templates.
   * Loader rejects any skill where an input name collides with a step id.
   * Only meaningful for `expose_as: tool` today — prompts ignore this
   * field (follow-up RFC).
   */
  inputs: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]*$/, "Input name must be lowercase alphanumeric with underscores"),
      SkillInputSchema,
    )
    .optional(),
  /**
   * MCP tool annotations for `expose_as: tool` skills. Defaults preserve
   * the original read-only local-workflow posture, while write-capable
   * built-ins can now make their runtime contract explicit for AppIntents,
   * MCP clients, and manifest consumers.
   */
  annotations: SkillAnnotationsSchema,
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
  /**
   * RFC 0012 Phase 1 prep — POSIX 5-field cron expression for autonomous
   * scheduled execution by the always-on daemon. Honored only when the
   * daemon is running (env `AIRMCP_DAEMON_MODE=true`); ignored entirely
   * in client-driven mode so existing skills behave unchanged.
   *
   * Format: `minute hour day-of-month month day-of-week`. See
   * `src/skills/scheduler/cron.ts` for the full grammar.
   *
   * Examples:
   *   "0 9 * * 1-5"   — weekdays 9:00 local time
   *   "* /15 * * * *" — every 15 minutes (no leading space, single token)
   *   "0 0 1 * *"     — first of every month at midnight
   */
  on_schedule: z
    .string()
    .regex(/^\S+(\s+\S+){4}$/, "Cron expression must have exactly 5 space-separated fields")
    .optional(),
  /**
   * RFC 0012 Phase 1 prep — autonomous-call HITL policy. Only consulted
   * when an autonomous skill (scheduled or event-driven) triggers a
   * destructive tool call AND the user is detected as absent
   * (`IOHIDIdleTime > AIRMCP_HITL_ABSENT_THRESHOLD_SEC`, default 60).
   *
   * Modes:
   *   - "queue" (default)  — buffer in `hitl-queue.jsonl`; menu-bar
   *                          surfaces; on user return notify and let
   *                          the user approve/reject each entry.
   *   - "proceed"          — fire immediately. `audit_log` records
   *                          `hitl_bypass: true`. Requires
   *                          `AIRMCP_AUTONOMOUS_DESTRUCTIVE=true`
   *                          environment opt-in.
   *   - "abort"            — skill fails on the destructive step with
   *                          `permission_denied` if user is absent.
   */
  hitl_policy: z
    .object({
      destructive_on_absence: z.enum(["queue", "proceed", "abort"]).optional().default("queue"),
      queue_ttl: z
        .string()
        .regex(/^\d+[mhd]$/, "Queue TTL must look like '4h', '30m', '2d'")
        .optional(),
      on_user_return: z.enum(["notify", "silent"]).optional().default("notify"),
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
  /** True when any step surfaced untrusted external content (a tool that
   *  returned `okUntrusted*`). The skill's final result is fenced with
   *  untrusted-content markers before it reaches the model. */
  untrusted?: boolean;
}
