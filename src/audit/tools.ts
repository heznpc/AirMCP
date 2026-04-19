import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, toolError } from "../shared/result.js";
import { readAuditEntries, summarizeAuditEntries } from "../shared/audit.js";

/**
 * Audit log consumption tools.
 *
 * The audit log is already populated by every tool-registry call with
 * PII-scrubbed args and 0600 file permissions. What's been missing is
 * a way for the user (or an agent acting on their behalf) to actually
 * ask "what has AirMCP done on my machine?". These two tools close
 * that loop:
 *
 *   audit_log      — paginated list of recent calls, filterable by
 *                    tool name / status / time window
 *   audit_summary  — aggregate stats: call count, error rate, top tools
 *
 * Both are read-only over the on-disk JSONL files (current + rotated).
 * The args are intentionally small so Claude can chain these into a
 * skill (e.g. "what did I do yesterday?") without argument bloat.
 */
export function registerAuditTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "audit_log",
    {
      title: "Audit Log",
      description:
        "Query the on-device audit log of tool calls. Reads JSONL rows from ~/.airmcp/audit.jsonl (+ rotated siblings) " +
        "and returns recent entries newest-first with optional filters by tool / status / time window. " +
        "Args are already PII-scrubbed at write-time; sensitive-tool entries have `_redacted` args.",
      inputSchema: {
        since: z
          .string()
          .datetime()
          .optional()
          .describe("Lower-bound ISO 8601 timestamp. Entries older than this are dropped. Defaults to 7 days ago."),
        tool: z.string().max(120).optional().describe("Filter to a single tool name (exact match)."),
        status: z.enum(["ok", "error"]).optional().describe("Filter by status. Omit to include both."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(100)
          .describe("Max entries to return (default: 100, max: 1000)."),
      },
      outputSchema: {
        total: z.number(),
        returned: z.number(),
        scannedFiles: z.number(),
        entries: z.array(
          z.object({
            timestamp: z.string(),
            tool: z.string(),
            status: z.enum(["ok", "error"]),
            durationMs: z.number().optional(),
            args: z.record(z.unknown()).optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ since, tool, status, limit }) => {
      try {
        const result = await readAuditEntries({ since, tool, status, limit });
        return okStructured(result);
      } catch (e) {
        return toolError("read audit log", e);
      }
    },
  );

  server.registerTool(
    "audit_summary",
    {
      title: "Audit Summary",
      description:
        "Aggregate the audit log over a time window — total call count, error rate, and the busiest tools. " +
        "Useful for weekly reviews and for spotting runaway agents (a sudden top-of-leaderboard `create_*` " +
        "tool is a red flag).",
      inputSchema: {
        since: z.string().datetime().optional().describe("Lower-bound ISO 8601 timestamp. Defaults to 7 days ago."),
        topN: z.number().int().min(1).max(50).optional().default(10).describe("Top-N busiest tools (default: 10)."),
      },
      outputSchema: {
        since: z.string(),
        total: z.number(),
        errors: z.number(),
        errorRate: z.number(),
        scannedFiles: z.number(),
        topTools: z.array(
          z.object({
            tool: z.string(),
            count: z.number(),
            errors: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ since, topN }) => {
      try {
        const result = await summarizeAuditEntries({ since, topN });
        return okStructured(result);
      } catch (e) {
        return toolError("summarize audit log", e);
      }
    },
  );
}
