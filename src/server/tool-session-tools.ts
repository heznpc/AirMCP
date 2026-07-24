import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import { errInvalidInput, errNotFound, errUpstream, okStructured } from "../shared/result.js";
import type { AirMcpConfig } from "../shared/config.js";
import type { HarnessAdapterPolicy } from "../shared/task-adapters.js";
import { ToolInputValidationError, type ToolRegistry } from "../shared/tool-registry.js";
import { TOOL_SESSION_CONTROL_TOOLS, toolSessions } from "../shared/tool-sessions.js";
import { isToolSearchIndexed, semanticToolSearch } from "../shared/tool-search.js";
import { usageTracker } from "../shared/usage-tracker.js";
import { generateProactiveContext } from "../shared/proactive.js";

export interface RegisterToolSessionToolsOptions {
  config: AirMcpConfig;
  harness: HarnessAdapterPolicy;
  toolRegistry: ToolRegistry;
}

export function registerToolSessionTools(server: McpServer, options: RegisterToolSessionToolsOptions): void {
  const { config, harness, toolRegistry } = options;

  server.registerTool(
    "start_tool_session",
    {
      title: "Start Tool Session",
      description:
        "Create a short-lived allowlist for discover_tools and run_tool. Use this to keep a task scoped to the tools it actually needs.",
      inputSchema: {
        tools: z
          .array(z.string().min(1).max(200))
          .min(1)
          .max(harness.maxSessionTools)
          .describe("Registered tool names allowed in this session"),
        ttlSeconds: z
          .number()
          .int()
          .min(30)
          .max(harness.maxSessionTtlSeconds)
          .optional()
          .describe(
            `Session lifetime in seconds (default ${harness.defaultSessionTtlSeconds}, max ${harness.maxSessionTtlSeconds})`,
          ),
        label: z.string().max(120).optional().describe("Optional human-readable task label"),
      },
      outputSchema: {
        sessionId: z.string(),
        label: z.string().optional(),
        allowedTools: z.array(z.string()),
        createdAt: z.string(),
        expiresAt: z.string(),
        remainingSeconds: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ tools, ttlSeconds, label }) => {
      const controlTools = new Set<string>(["run_tool", ...TOOL_SESSION_CONTROL_TOOLS]);
      const unknown = tools.filter((name: string) => !toolRegistry.getToolInfo(name));
      if (unknown.length) return errNotFound(`Unknown tools: ${unknown.join(", ")}`);
      const blocked = tools.filter((name: string) => controlTools.has(name));
      if (blocked.length) {
        return errInvalidInput(`Tool sessions cannot delegate session-control tools: ${blocked.join(", ")}`);
      }
      return okStructured(
        toolSessions.start({ tools, ttlSeconds: ttlSeconds ?? harness.defaultSessionTtlSeconds, label }),
      );
    },
  );

  server.registerTool(
    "tool_session_status",
    {
      title: "Tool Session Status",
      description: "Inspect one active tool session by id without listing other clients' sessions.",
      inputSchema: {
        sessionId: z.string().uuid().describe("Session id returned by start_tool_session"),
      },
      outputSchema: {
        sessionId: z.string(),
        label: z.string().optional(),
        allowedTools: z.array(z.string()),
        createdAt: z.string(),
        expiresAt: z.string(),
        remainingSeconds: z.number(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sessionId }) => {
      const session = toolSessions.get(sessionId);
      if (!session) return errNotFound(`Tool session "${sessionId}" was not found or has expired.`);
      return okStructured(session);
    },
  );

  server.registerTool(
    "end_tool_session",
    {
      title: "End Tool Session",
      description: "End a tool session before its TTL expires.",
      inputSchema: {
        sessionId: z.string().uuid().describe("Session id returned by start_tool_session"),
      },
      outputSchema: {
        sessionId: z.string(),
        ended: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sessionId }) => {
      return okStructured({ sessionId, ended: toolSessions.end(sessionId) });
    },
  );

  server.registerTool(
    "describe_tool",
    {
      title: "Describe Tool",
      description:
        "Fetch the full description for one registered AirMCP tool after discover_tools returns a compact match.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Registered tool name to describe"),
        full: z.boolean().optional().describe("Return the full description instead of the compact summary"),
        sessionId: z
          .string()
          .uuid()
          .optional()
          .describe("Optional task-scoped tool session id; requires the tool to be in the session allowlist"),
      },
      outputSchema: {
        name: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        descriptionDetail: z.enum(["summary", "full"]),
        exposed: z.boolean(),
        readOnly: z.boolean().optional(),
        destructive: z.boolean().optional(),
        sensitive: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, full, sessionId }) => {
      const sessionGate = toolSessions.assertAllowed(sessionId, name);
      if (!sessionGate.ok) return errInvalidInput(sessionGate.message);
      const descriptionMode = full === false ? "summary" : "full";
      const details = toolRegistry.getToolDetails(name, { descriptionMode });
      if (!details) return errNotFound(`Unknown tool "${name}". Use discover_tools to find available tools.`);
      return okStructured({ ...details, descriptionDetail: descriptionMode });
    },
  );

  server.registerTool(
    "run_tool",
    {
      title: "Run Tool",
      description:
        "Run an AirMCP tool by name with JSON arguments. Use discover_tools first when the tool is not visible in tools/list.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Registered tool name to run"),
        args: z.record(z.string(), z.unknown()).optional().describe("Tool arguments as a JSON object"),
        sessionId: z.string().uuid().optional().describe("Optional task-scoped tool session id"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, args, sessionId }) => {
      if (name === "run_tool" || (TOOL_SESSION_CONTROL_TOOLS as readonly string[]).includes(name)) {
        return errInvalidInput("run_tool cannot call itself or session-control tools");
      }
      const info = toolRegistry.getToolInfo(name);
      if (!info) {
        return errNotFound(`Unknown tool "${name}". Use discover_tools to find available tools.`);
      }
      const hiddenTool = !toolRegistry.getExposedToolNames().includes(name);
      if (harness.requireSessionForHiddenTools && hiddenTool && !sessionId) {
        return errInvalidInput(
          `Tool session required for hidden tool "${name}". Call start_tool_session with this tool, then pass sessionId to run_tool.`,
        );
      }
      const sessionGate = toolSessions.assertAllowed(sessionId, name);
      if (!sessionGate.ok) return errInvalidInput(sessionGate.message);
      try {
        return await toolRegistry.callTool(name, args ?? {});
      } catch (e) {
        if (e instanceof ToolInputValidationError) {
          return errInvalidInput(e.message);
        }
        return errUpstream(`Failed to run tool "${name}": ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "discover_tools",
    {
      title: "Discover Tools",
      description:
        "Search available tools by keyword. Returns matching tools with descriptions. " +
        "Use this instead of scanning the full tool catalog — describe what you need and get relevant tools.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("Search query — e.g. 'calendar', 'send email', 'music playback'"),
        limit: z.number().min(1).max(50).optional().describe("Max results (default 20)"),
        sessionId: z
          .string()
          .uuid()
          .optional()
          .describe("Optional task-scoped tool session id; limits matches to the session allowlist"),
      },
      outputSchema: {
        query: z.string(),
        matches: z.array(
          z.object({
            name: z.string(),
            title: z.string().optional(),
            description: z.string().optional(),
          }),
        ),
        total: z.number().optional(),
        method: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit, sessionId }) => {
      const maxResults = limit ?? 20;
      const allowedToolNames = sessionId ? toolSessions.getAllowedTools(sessionId) : null;
      if (sessionId && !allowedToolNames) {
        return errNotFound(`Tool session "${sessionId}" was not found or has expired.`);
      }
      const substringResults = toolRegistry.searchTools(query, maxResults, {
        ...(allowedToolNames ? { allowedToolNames } : {}),
        descriptionMode: harness.discoveryDescriptionMode,
      });

      if (substringResults.length >= 3 || !isToolSearchIndexed(toolRegistry)) {
        const result = { query, matches: substringResults, total: substringResults.length, method: "keyword" };
        return okStructured(result);
      }

      const semanticResults = (await semanticToolSearch(query, maxResults, undefined, toolRegistry)).filter(
        (result) => !allowedToolNames || allowedToolNames.has(result.name),
      );

      const seen = new Set(substringResults.map((r) => r.name));
      const merged = [...substringResults];
      for (const r of semanticResults) {
        if (!seen.has(r.name)) {
          merged.push(r);
          seen.add(r.name);
        }
      }

      const final = merged.slice(0, maxResults);
      if (final.length === 0) {
        const result = {
          query,
          matches: [] as typeof final,
          hint: "Try broader terms or check module names: notes, calendar, reminders, mail, music, contacts, finder, safari, system, photos, messages, shortcuts",
        };
        return okStructured(result);
      }
      const result = {
        query,
        matches: final,
        total: final.length,
        method: substringResults.length > 0 ? "keyword+semantic" : "semantic",
      };
      return okStructured(result);
    },
  );

  if (config.features.usageTracking) {
    server.registerTool(
      "suggest_next_tools",
      {
        title: "Suggest Next Tools",
        description:
          "Rank the tools that most often followed a given tool in this install's local call history. " +
          "A deterministic frequency count over recorded tool-sequence pairs — no model, no learning, just tallied usage counts.",
        inputSchema: {
          after: z.string().min(1).max(500).describe("Tool name to get suggestions for — e.g. 'today_events'"),
          limit: z.number().min(1).max(20).optional().describe("Max suggestions (default 5)"),
        },
        outputSchema: {
          after: z.string(),
          suggestions: z.array(
            z.object({
              tool: z.string(),
              count: z.number(),
            }),
          ),
          totalCalls: z.number(),
          hint: z.string().optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ after, limit }) => {
        const next = usageTracker.getNextTools(after, limit ?? 5);
        const stats = usageTracker.getStats();
        if (next.length === 0) {
          const result = {
            after,
            suggestions: [] as { tool: string; count: number }[],
            hint: "No usage patterns recorded yet. Use tools normally and suggestions will appear over time.",
            totalCalls: stats.totalCalls,
          };
          return okStructured(result);
        }
        const result = { after, suggestions: next, totalCalls: stats.totalCalls };
        return okStructured(result);
      },
    );
  }

  if (config.features.proactiveContext) {
    server.registerTool(
      "proactive_context",
      {
        title: "Proactive Context",
        description:
          "Return tool/workflow candidates ranked by a deterministic heuristic over the current time of day, day of week, " +
          "and this install's tallied usage counts. No model and no inference — it surfaces likely-relevant tools from " +
          "recorded history; it does not decide, learn, or act.",
        inputSchema: {},
        outputSchema: {
          timeContext: z.object({
            period: z.enum(["morning", "afternoon", "evening", "night"]),
            hour: z.number(),
            isWeekend: z.boolean(),
          }),
          suggestedTools: z.array(
            z.object({
              tool: z.string(),
              reason: z.string(),
            }),
          ),
          suggestedWorkflows: z.array(z.string()),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => {
        const bundle = generateProactiveContext();
        return okStructured(bundle);
      },
    );
  }
}
