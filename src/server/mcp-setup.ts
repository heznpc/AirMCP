/**
 * MCP server creation — module loading, tool/prompt/resource registration,
 * and banner metadata collection.
 */

import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer as LightMcpServer } from "../shared/mcp.js";
import { z } from "zod";
import { ok, okStructured, err, toolError } from "../shared/result.js";
import { registerCrossPrompts } from "../cross/prompts.js";
import { registerCrossTools } from "../cross/tools.js";
import { registerSemanticTools } from "../semantic/tools.js";
import { registerResources } from "../shared/resources.js";
import { registerSetupTools } from "../shared/setup.js";
import { registerSkillEngine } from "../skills/index.js";
import { getRegisteredTriggers } from "../skills/triggers.js";
import { registerApps } from "../apps/tools.js";
import { getCompatibilityEnv, isModuleEnabled, NPM_PACKAGE_NAME, type AirMcpConfig } from "../shared/config.js";
import { loadModuleRegistry, setModuleRegistry } from "../shared/modules.js";
import { resolveModuleCompatibility } from "../shared/compatibility.js";
import { registerDynamicShortcutTools } from "../shortcuts/tools.js";
import { HitlClient } from "../shared/hitl.js";
import { installHitlGuard } from "../shared/hitl-guard.js";
import { toolRegistry } from "../shared/tool-registry.js";
import { semanticToolSearch, isToolSearchIndexed, indexToolDescriptions } from "../shared/tool-search.js";
import { isCompactMode } from "../shared/tool-filter.js";
import { usageTracker } from "../shared/usage-tracker.js";
import { generateProactiveContext } from "../shared/proactive.js";
import { eventBus } from "../shared/event-bus.js";
import { startPollers } from "../shared/pollers.js";
import { resourceCache } from "../shared/cache.js";
import { checkSwiftBridge, runSwift } from "../shared/swift.js";
import type { BannerInfo } from "../shared/banner.js";
import { SERVER_ICON, WEBSITE_URL } from "../shared/icons.js";

export interface CreateServerOptions {
  config: AirMcpConfig;
  hitlClient: HitlClient | null;
  osVersion: number;
  pkg: { version: string; description?: string };
}

export async function createServer(
  options: CreateServerOptions,
): Promise<{ server: SdkMcpServer; bannerInfo: BannerInfo; cleanupEventListeners: () => void }> {
  const { config, hitlClient, osVersion, pkg } = options;

  const server = new SdkMcpServer({
    name: NPM_PACKAGE_NAME,
    version: pkg.version,
    description: pkg.description,
    websiteUrl: WEBSITE_URL,
    icons: [SERVER_ICON],
  });
  // Cast to lightweight McpServer for module registration (avoids heavy generic inference)
  const lServer = server as unknown as LightMcpServer;

  // Install tool/prompt registry FIRST so its interception runs as the
  // innermost wrapper. The HITL guard then re-patches registerTool, becoming
  // the outermost wrapper. Order matters: when a module calls registerTool,
  // HITL wraps the callback first, then the registry wraps that HITL-wrapped
  // handler with audit/usage tracking and stores it in its map. This makes
  // the stored handler `audit(HITL(callback))` so that skill execution via
  // toolRegistry.callTool() also goes through HITL approval.
  toolRegistry.installOn(lServer);

  if (hitlClient && config.hitl.level !== "off") {
    installHitlGuard(lServer, hitlClient, config);
  }

  // Dynamic module loading — only imports modules at startup
  const MODULE_REGISTRY = await loadModuleRegistry();
  setModuleRegistry(MODULE_REGISTRY);

  // RFC 0004: route every module through the compatibility resolver. The
  // resolver folds in minMacosVersion (legacy gate), maxMacosVersion, brokenOn,
  // requiresHardware, status:"broken", and deprecation schedules into a single
  // typed decision. We keep the legacy minMacosVersion field as a fallback for
  // modules that haven't been annotated yet.
  const compatEnv = getCompatibilityEnv();
  const enabled: string[] = [];
  const disabled: string[] = [];
  const osBlocked: string[] = [];
  const deprecated: string[] = [];
  const broken: string[] = [];
  let shortcutsEnabled = false;
  for (const mod of MODULE_REGISTRY) {
    // Synthesise a manifest when the module only has the legacy field set.
    const compatManifest =
      mod.compatibility ?? (mod.minMacosVersion ? { minMacosVersion: mod.minMacosVersion } : undefined);
    const decision = resolveModuleCompatibility(mod.name, compatManifest, compatEnv);

    if (decision.decision === "skip-unsupported") {
      osBlocked.push(`${mod.name} (${decision.reason})`);
      continue;
    }
    if (decision.decision === "skip-broken") {
      broken.push(`${mod.name} (${decision.reason})`);
      continue;
    }

    if (!isModuleEnabled(config, mod.name)) {
      disabled.push(mod.name);
      continue;
    }

    try {
      mod.tools(lServer, config);
      mod.prompts?.(lServer);
    } catch (e) {
      console.error(`[AirMCP] Failed to register module ${mod.name}: ${e instanceof Error ? e.message : String(e)}`);
      disabled.push(mod.name);
      continue;
    }
    enabled.push(mod.name);
    if (mod.name === "shortcuts") shortcutsEnabled = true;

    if (decision.decision === "register-with-deprecation") {
      deprecated.push(mod.name);
      console.error(`[AirMCP] ${decision.reason}`);
    }
  }
  // Dynamic shortcut tools: auto-discover and register individual shortcuts
  let dynamicShortcutCount = 0;
  if (shortcutsEnabled) {
    dynamicShortcutCount = await registerDynamicShortcutTools(lServer);
  }

  // Cross-module workflows
  registerCrossPrompts(lServer);
  registerCrossTools(lServer, config);

  // Semantic search (on-device embeddings via Swift bridge)
  registerSemanticTools(lServer, config);

  // MCP Resources
  registerResources(lServer, config);

  // Setup & diagnostics
  registerSetupTools(lServer, config);

  // Personal Skills Engine (YAML-based workflows)
  await registerSkillEngine(lServer);

  // MCP Apps — interactive UI views (Calendar week, Music player)
  registerApps(lServer, {
    calendar: enabled.includes("calendar"),
    music: enabled.includes("music"),
  });

  // discover_tools: SEP-1821-inspired dynamic tool discovery
  lServer.registerTool(
    "discover_tools",
    {
      title: "Discover Tools",
      description:
        "Search available tools by keyword. Returns matching tools with descriptions. " +
        "Use this instead of scanning all 250+ tools — describe what you need and get relevant tools.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("Search query — e.g. 'calendar', 'send email', 'music playback'"),
        limit: z.number().min(1).max(50).optional().describe("Max results (default 20)"),
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
    async ({ query, limit }) => {
      const maxResults = limit ?? 20;
      const substringResults = toolRegistry.searchTools(query, maxResults);

      // If substring search found enough, return immediately
      if (substringResults.length >= 3 || !isToolSearchIndexed()) {
        const result = { query, matches: substringResults, total: substringResults.length, method: "keyword" };
        return okStructured(result);
      }

      // Fallback to semantic search
      const semanticResults = await semanticToolSearch(query, maxResults);

      // Merge: substring first, then semantic (deduplicated)
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

  // suggest_next_tools: usage-pattern-based tool recommendations (requires usageTracking)
  if (config.features.usageTracking)
    lServer.registerTool(
      "suggest_next_tools",
      {
        title: "Suggest Next Tools",
        description:
          "Based on your usage patterns, suggest which tools typically follow a given tool. " +
          "Learns from how you use AirMCP over time. Returns frequently-used tool sequences.",
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

  // proactive_context: time/pattern-aware context suggestions (requires proactiveContext)
  if (config.features.proactiveContext)
    lServer.registerTool(
      "proactive_context",
      {
        title: "Proactive Context",
        description:
          "Get contextually relevant tool and workflow suggestions based on time of day, day of week, and your usage patterns. " +
          "Like Siri Suggestions but for MCP — tells you what you probably want to do right now.",
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

  // Named event handlers — stored so they can be removed when the server closes
  // (prevents listener accumulation across HTTP sessions).
  const SNAPSHOT_KEYS = ["snapshot:standard", "snapshot:brief", "snapshot:full"];

  function invalidateAndNotify(keys: string[]): void {
    for (const k of keys) resourceCache.delete(k);
    try {
      server.sendResourceListChanged();
    } catch {
      /* client may not support notifications */
    }
  }

  const onCalendarChanged = () => invalidateAndNotify(["calendar:today", "calendar:upcoming", ...SNAPSHOT_KEYS]);
  const onRemindersChanged = () => invalidateAndNotify(["reminders:due", "reminders:today", ...SNAPSHOT_KEYS]);
  const onPasteboardChanged = () => invalidateAndNotify(["system:clipboard"]);
  const onMailUnreadChanged = () => invalidateAndNotify(["mail:unread", ...SNAPSHOT_KEYS]);
  const onFocusModeChanged = () => invalidateAndNotify(["system:focus", ...SNAPSHOT_KEYS]);
  const onNowPlayingChanged = () => invalidateAndNotify(["music:now", ...SNAPSHOT_KEYS]);
  const onFileModified = () => invalidateAndNotify(["finder:recent"]);

  // event_subscribe: start real-time event observation
  lServer.registerTool(
    "event_subscribe",
    {
      title: "Subscribe to Events",
      description:
        "Start real-time monitoring of Apple data changes: calendar, reminders, clipboard, mail unread count, focus mode, now-playing track, and watched file paths. " +
        "Native observers (calendar/reminders/clipboard/focus/files) are pushed from the Swift bridge; mail and now-playing are polled. " +
        "Requires the Swift bridge in persistent mode for the native observers.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        if (eventBus.isRunning) {
          return ok({ status: "already_running", message: "Event observer is already active" });
        }
        await runSwift("start-observer", "{}");
        // Remove any existing listeners before re-attaching (idempotent)
        eventBus.off("calendar_changed", onCalendarChanged);
        eventBus.off("reminders_changed", onRemindersChanged);
        eventBus.off("pasteboard_changed", onPasteboardChanged);
        eventBus.off("mail_unread_changed", onMailUnreadChanged);
        eventBus.off("focus_mode_changed", onFocusModeChanged);
        eventBus.off("now_playing_changed", onNowPlayingChanged);
        eventBus.off("file_modified", onFileModified);
        eventBus.start();

        // Connect events to MCP resource notifications
        eventBus.on("calendar_changed", onCalendarChanged);
        eventBus.on("reminders_changed", onRemindersChanged);
        eventBus.on("pasteboard_changed", onPasteboardChanged);
        eventBus.on("mail_unread_changed", onMailUnreadChanged);
        eventBus.on("focus_mode_changed", onFocusModeChanged);
        eventBus.on("now_playing_changed", onNowPlayingChanged);
        eventBus.on("file_modified", onFileModified);

        // Start Node-side pollers for mail unread and now-playing.
        // Safe to call multiple times (idempotent).
        startPollers();

        return ok({
          status: "started",
          monitoring: [
            "calendar",
            "reminders",
            "pasteboard",
            "mail_unread",
            "focus_mode",
            "now_playing",
            "file_modified",
          ],
        });
      } catch (e) {
        return toolError("start event observer", e);
      }
    },
  );

  // event_status: check what events have been detected
  lServer.registerTool(
    "event_status",
    {
      title: "Event Monitor Status",
      description: "Check if real-time event monitoring is active.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      return ok({ running: eventBus.isRunning });
    },
  );

  // list_triggers: show all skills with event triggers
  lServer.registerTool(
    "list_triggers",
    {
      title: "List Event Triggers",
      description:
        "Show all skills with event triggers (calendar_changed, reminders_changed, pasteboard_changed, mail_unread_changed, focus_mode_changed, now_playing_changed, file_modified) and their debounce settings.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const triggers = getRegisteredTriggers();
      return ok({ triggers, total: triggers.length });
    },
  );

  // cloud_sync: cross-device data synchronization
  lServer.registerTool(
    "cloud_sync_status",
    {
      title: "iCloud Sync Status",
      description: "Check iCloud sync status — see what usage data and config is synced across your Apple devices.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return err(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift("cloud-sync-status", "{}");
        return ok(result);
      } catch (e) {
        return toolError("check iCloud sync", e);
      }
    },
  );

  // get_workflow: expose prompt handlers as a tool for autonomous agents (Cowork, etc.)
  lServer.registerTool(
    "get_workflow",
    {
      title: "Get Workflow",
      description:
        "Retrieve a registered MCP prompt by name and return its workflow instructions as text. " +
        "Useful in autonomous/Cowork environments where prompts cannot be invoked directly.",
      inputSchema: {
        name: z.string().min(1).max(500).describe("Prompt name (e.g. 'daily-briefing', 'dev-session')"),
        args: z.record(z.string()).optional().describe("Prompt arguments as key-value pairs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, args }) => {
      const callback = toolRegistry.getPromptCallback(name);
      if (!callback) {
        const available = toolRegistry.getPromptNames().sort();
        return err(`Unknown prompt "${name}". Available: ${available.join(", ")}`);
      }
      try {
        const result = await callback(args ?? {}, {});
        const text = result?.messages?.[0]?.content?.text ?? JSON.stringify(result);
        return ok({ prompt: name, description: result?.description, workflow: text });
      } catch (e) {
        return err(`Failed to get workflow: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // Index tool descriptions for semantic search (non-blocking, if enabled)
  if (config.features.semanticToolSearch) {
    indexToolDescriptions().catch((e) => {
      console.error(`[AirMCP] Semantic tool index failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  // Collect banner info for startup display
  const toolCount = toolRegistry.getToolCount();
  const promptCount = toolRegistry.getPromptCount();

  const bannerInfo: BannerInfo = {
    version: pkg.version,
    transport: "stdio",
    modulesEnabled: enabled,
    modulesDisabled: disabled,
    modulesOsBlocked: osBlocked,
    modulesDeprecated: deprecated,
    modulesBroken: broken,
    toolCount,
    promptCount,
    dynamicShortcuts: dynamicShortcutCount,
    skillsBuiltin: 3,
    skillsUser: 0,
    hitlLevel: config.hitl.level,
    macosVersion: osVersion,
    nodeVersion: process.version.slice(1),
    sendMessages: config.allowSendMessages,
    sendMail: config.allowSendMail,
    compactTools: isCompactMode(),
  };

  /** Remove this server's eventBus listeners. Call on session close to prevent listener accumulation. */
  const cleanupEventListeners = () => {
    eventBus.off("calendar_changed", onCalendarChanged);
    eventBus.off("reminders_changed", onRemindersChanged);
    eventBus.off("pasteboard_changed", onPasteboardChanged);
  };

  return { server, bannerInfo, cleanupEventListeners };
}
