import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { ok, okLinkedStructured, err, toolError } from "../shared/result.js";

export function registerHealthTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "health_summary",
    {
      title: "Health Summary",
      description:
        "Get a combined health dashboard: today's steps, 7-day average heart rate, last night's sleep, active energy burned, and exercise minutes. All data is aggregated — no raw samples or timestamps.",
      inputSchema: {},
      outputSchema: {
        stepsToday: z.number().describe("Step count today"),
        heartRateAvg7d: z.number().nullable().describe("7-day average resting heart rate (bpm)"),
        sleepHoursLastNight: z.number().describe("Hours slept last night"),
        activeEnergyToday: z.number().describe("Active calories burned today"),
        exerciseMinutesToday: z.number().describe("Exercise minutes today"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{
          stepsToday: number;
          heartRateAvg7d: number | null;
          sleepHoursLastNight: number;
          activeEnergyToday: number;
          exerciseMinutesToday: number;
        }>("health-summary", "{}");
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
      outputSchema: {
        stepsToday: z.number().describe("Step count today"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ stepsToday: number }>("health-steps", "{}");
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
      outputSchema: {
        heartRateAvg7d: z.number().nullable().describe("7-day average resting heart rate (bpm); null if unavailable"),
        message: z.string().optional().describe("Explanation when heartRateAvg7d is null (e.g. insufficient data)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ heartRateAvg7d: number | null; message?: string }>("health-heart-rate", "{}");
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
      outputSchema: {
        sleepHours: z.number().describe("Total sleep hours (actual sleep stages, not time in bed)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }: { date?: string }) => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        const input = date ? JSON.stringify({ date }) : "{}";
        const result = await runSwift<{ sleepHours: number }>("health-sleep", input);
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
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ authorized: boolean }>("health-authorize", "{}");
        return ok(result);
      } catch (e) {
        return toolError("authorize HealthKit", e);
      }
    },
  );
}
