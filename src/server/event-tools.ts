import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import { errNotFound, errSwift, errUpstream, ok, toolError } from "../shared/result.js";
import { getRegisteredTriggers } from "../skills/triggers.js";
import { eventBus } from "../shared/event-bus.js";
import { startPollers } from "../shared/pollers.js";
import { resourceCache } from "../shared/cache.js";
import { checkSwiftBridge, runSwift } from "../shared/swift.js";
import { toolRegistry } from "../shared/tool-registry.js";

export interface RegisterEventToolsOptions {
  notifyResourceListChanged: () => void;
}

export function registerEventTools(server: McpServer, options: RegisterEventToolsOptions): () => void {
  const SNAPSHOT_KEYS = ["snapshot:standard", "snapshot:brief", "snapshot:full"];

  function invalidateAndNotify(keys: string[]): void {
    for (const key of keys) resourceCache.delete(key);
    try {
      options.notifyResourceListChanged();
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
  const onScreenLocked = () => invalidateAndNotify(SNAPSHOT_KEYS);
  const onScreenUnlocked = () => invalidateAndNotify(SNAPSHOT_KEYS);

  server.registerTool(
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
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        if (eventBus.isRunning) {
          return ok({ status: "already_running", message: "Event observer is already active" });
        }
        await runSwift("start-observer", "{}");
        eventBus.off("calendar_changed", onCalendarChanged);
        eventBus.off("reminders_changed", onRemindersChanged);
        eventBus.off("pasteboard_changed", onPasteboardChanged);
        eventBus.off("mail_unread_changed", onMailUnreadChanged);
        eventBus.off("focus_mode_changed", onFocusModeChanged);
        eventBus.off("now_playing_changed", onNowPlayingChanged);
        eventBus.off("file_modified", onFileModified);
        eventBus.off("screen_locked", onScreenLocked);
        eventBus.off("screen_unlocked", onScreenUnlocked);
        eventBus.start();

        eventBus.on("calendar_changed", onCalendarChanged);
        eventBus.on("reminders_changed", onRemindersChanged);
        eventBus.on("pasteboard_changed", onPasteboardChanged);
        eventBus.on("mail_unread_changed", onMailUnreadChanged);
        eventBus.on("focus_mode_changed", onFocusModeChanged);
        eventBus.on("now_playing_changed", onNowPlayingChanged);
        eventBus.on("file_modified", onFileModified);
        eventBus.on("screen_locked", onScreenLocked);
        eventBus.on("screen_unlocked", onScreenUnlocked);

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
            "screen_locked",
            "screen_unlocked",
          ],
        });
      } catch (e) {
        return toolError("start event observer", e);
      }
    },
  );

  server.registerTool(
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

  server.registerTool(
    "list_triggers",
    {
      title: "List Event Triggers",
      description:
        "Show all skills with event triggers (calendar_changed, reminders_changed, pasteboard_changed, mail_unread_changed, focus_mode_changed, now_playing_changed, file_modified, screen_locked, screen_unlocked) and their debounce settings.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const triggers = getRegisteredTriggers();
      return ok({ triggers, total: triggers.length });
    },
  );

  server.registerTool(
    "cloud_sync_status",
    {
      title: "iCloud Sync Status",
      description: "Check iCloud sync status — see what usage data and config is synced across your Apple devices.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift("cloud-sync-status", "{}");
        return ok(result);
      } catch (e) {
        return toolError("check iCloud sync", e);
      }
    },
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get Workflow",
      description:
        "Retrieve a registered MCP prompt by name and return its workflow instructions as text. " +
        "Useful in autonomous/Cowork environments where prompts cannot be invoked directly.",
      inputSchema: {
        name: z.string().min(1).max(500).describe("Prompt name (e.g. 'daily-briefing', 'dev-session')"),
        args: z.record(z.string(), z.string()).optional().describe("Prompt arguments as key-value pairs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, args }) => {
      const callback = toolRegistry.getPromptCallback(name);
      if (!callback) {
        const available = toolRegistry.getPromptNames().sort();
        return errNotFound(`Unknown prompt "${name}". Available: ${available.join(", ")}`);
      }
      try {
        const result = await callback(args ?? {}, {});
        const text = result?.messages?.[0]?.content?.text ?? JSON.stringify(result);
        return ok({ prompt: name, description: result?.description, workflow: text });
      } catch (e) {
        return errUpstream(`Failed to get workflow: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  return () => {
    eventBus.off("calendar_changed", onCalendarChanged);
    eventBus.off("reminders_changed", onRemindersChanged);
    eventBus.off("pasteboard_changed", onPasteboardChanged);
    eventBus.off("mail_unread_changed", onMailUnreadChanged);
    eventBus.off("focus_mode_changed", onFocusModeChanged);
    eventBus.off("now_playing_changed", onNowPlayingChanged);
    eventBus.off("file_modified", onFileModified);
    eventBus.off("screen_locked", onScreenLocked);
    eventBus.off("screen_unlocked", onScreenUnlocked);
  };
}
