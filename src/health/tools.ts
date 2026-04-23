import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { ok, okLinkedStructured, errSwift, toolError } from "../shared/result.js";

// Single source of truth for each Swift bridge payload. The zod shape drives
// outputSchema validation; z.infer derives the TypeScript type that runSwift
// returns, so adding a field to HealthKit only touches one definition.
const healthSummaryShape = {
  stepsToday: z.number().describe("Step count today"),
  heartRateAvg7d: z.number().nullable().describe("7-day average resting heart rate (bpm)"),
  sleepHoursLastNight: z.number().describe("Hours slept last night"),
  activeEnergyToday: z.number().describe("Active calories burned today"),
  exerciseMinutesToday: z.number().describe("Exercise minutes today"),
};
const healthStepsShape = {
  stepsToday: z.number().describe("Step count today"),
};
const healthHeartRateShape = {
  heartRateAvg7d: z.number().nullable().describe("7-day average resting heart rate (bpm); null if unavailable"),
  message: z.string().optional().describe("Explanation when heartRateAvg7d is null (e.g. insufficient data)"),
};
const healthSleepShape = {
  sleepHours: z.number().describe("Total sleep hours (actual sleep stages, not time in bed)"),
};

type HealthSummary = z.infer<ReturnType<typeof z.object<typeof healthSummaryShape>>>;
type HealthSteps = z.infer<ReturnType<typeof z.object<typeof healthStepsShape>>>;
type HealthHeartRate = z.infer<ReturnType<typeof z.object<typeof healthHeartRateShape>>>;
type HealthSleep = z.infer<ReturnType<typeof z.object<typeof healthSleepShape>>>;

// ── Swift bridge contract fixtures (hand-maintained mirror of Swift emit) ──
//
// These are the JSON shapes the Swift CLI (swift/Sources/AirMcpBridge/main.swift
// cases "health-summary" / "health-steps" / "health-heart-rate" / "health-sleep"
// backed by swift/Sources/AirMCPKit/HealthService.swift struct HealthSummary)
// is expected to write to stdout. Until the planned `--dump-example-output`
// Swift flag lands, drift between Swift struct edits and TS zod shapes is
// caught in two places:
//
// (1) compile time — the EXAMPLE constant is typed against the zod-inferred
//     interface, so `tsc` flags a missing/renamed field;
// (2) runtime — tests/script-shape-contract.test.js parses each example
//     through the tool's declared outputSchema with strict Zod.
//
// When you change a Swift Encodable struct, update the matching EXAMPLE here
// in the same PR. Both sides of the bridge must move together.
export const HEALTH_SUMMARY_EXAMPLE: HealthSummary = {
  stepsToday: 8432,
  heartRateAvg7d: 62.3,
  sleepHoursLastNight: 7.25,
  activeEnergyToday: 412.5,
  exerciseMinutesToday: 38,
};

export const HEALTH_STEPS_EXAMPLE: HealthSteps = {
  stepsToday: 8432,
};

// Two fixtures for heart rate because message is optional; both cases must parse.
export const HEALTH_HEART_RATE_EXAMPLE_VALUE: HealthHeartRate = {
  heartRateAvg7d: 62.3,
};
export const HEALTH_HEART_RATE_EXAMPLE_NULL: HealthHeartRate = {
  heartRateAvg7d: null,
  message: "No heart rate data for the last 7 days",
};

export const HEALTH_SLEEP_EXAMPLE: HealthSleep = {
  sleepHours: 7.25,
};

export function registerHealthTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "health_summary",
    {
      title: "Health Summary",
      description:
        "Get a combined health dashboard: today's steps, 7-day average heart rate, last night's sleep, active energy burned, and exercise minutes. All data is aggregated — no raw samples or timestamps.",
      inputSchema: {},
      outputSchema: healthSummaryShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<HealthSummary>("health-summary", "{}");
        return okLinkedStructured("health_summary", result);
      } catch (e) {
        return toolError("get health summary", e);
      }
    },
  );

  server.registerTool(
    "health_today_steps",
    {
      title: "Today's Steps",
      description: "Get aggregated step count for today from HealthKit.",
      inputSchema: {},
      outputSchema: healthStepsShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<HealthSteps>("health-steps", "{}");
        return okLinkedStructured("health_today_steps", result);
      } catch (e) {
        return toolError("get step count", e);
      }
    },
  );

  server.registerTool(
    "health_heart_rate",
    {
      title: "Recent Heart Rate",
      description: "Get average resting heart rate over the last 7 days (bpm) from HealthKit.",
      inputSchema: {},
      outputSchema: healthHeartRateShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<HealthHeartRate>("health-heart-rate", "{}");
        return okLinkedStructured("health_heart_rate", result);
      } catch (e) {
        return toolError("get heart rate", e);
      }
    },
  );

  server.registerTool(
    "health_sleep",
    {
      title: "Sleep Analysis",
      description:
        "Get total sleep hours for a given date (defaults to last night). Only counts actual sleep stages, not time in bed.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("ISO 8601 date (e.g. '2026-03-22'). Defaults to today (last night's sleep)."),
      },
      outputSchema: healthSleepShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }: { date?: string }) => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const input = date ? JSON.stringify({ date }) : "{}";
        const result = await runSwift<HealthSleep>("health-sleep", input);
        return okLinkedStructured("health_sleep", result);
      } catch (e) {
        return toolError("get sleep data", e);
      }
    },
  );

  server.registerTool(
    "health_authorize",
    {
      title: "Authorize HealthKit",
      description:
        "Request read-only HealthKit authorization. Call this first if other health tools return permission errors.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ authorized: boolean }>("health-authorize", "{}");
        return ok(result);
      } catch (e) {
        return toolError("authorize HealthKit", e);
      }
    },
  );
}
