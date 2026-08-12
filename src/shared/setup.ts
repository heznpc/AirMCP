import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { HOME } from "./constants.js";
import type { McpServer } from "./mcp.js";
import { runJxa } from "./jxa.js";
import { hasSwiftCommand, runSwift } from "./swift.js";
import { MAC_PERMISSION_SETTINGS, ok, type MacPermissionCategory } from "./result.js";
import { AirMcpConfig, isModuleEnabled } from "./config.js";

/** Map: module name → macOS app name + permission-probe script */
const MODULE_APP_MAP: Array<{ module: string; name: string; script: string }> = [
  {
    module: "notes",
    name: "Notes",
    script: "const Notes = Application('Notes'); JSON.stringify({app: 'Notes', accessible: true});",
  },
  {
    module: "reminders",
    name: "Reminders",
    script: "const Reminders = Application('Reminders'); JSON.stringify({app: 'Reminders', accessible: true});",
  },
  {
    module: "calendar",
    name: "Calendar",
    script: "const Calendar = Application('Calendar'); JSON.stringify({app: 'Calendar', accessible: true});",
  },
  {
    module: "contacts",
    name: "Contacts",
    script: "const Contacts = Application('Contacts'); JSON.stringify({app: 'Contacts', accessible: true});",
  },
  {
    module: "mail",
    name: "Mail",
    script: "const Mail = Application('Mail'); JSON.stringify({app: 'Mail', accessible: true});",
  },
  {
    module: "music",
    name: "Music",
    script: "const Music = Application('Music'); JSON.stringify({app: 'Music', accessible: true});",
  },
  {
    module: "finder",
    name: "Finder",
    script: "const Finder = Application('Finder'); JSON.stringify({app: 'Finder', accessible: true});",
  },
  {
    module: "safari",
    name: "Safari",
    script: "const Safari = Application('Safari'); JSON.stringify({app: 'Safari', accessible: true});",
  },
  {
    module: "system",
    name: "System Events",
    script: "const SE = Application('System Events'); JSON.stringify({app: 'System Events', accessible: true});",
  },
  {
    module: "photos",
    name: "Photos",
    script: "const Photos = Application('Photos'); JSON.stringify({app: 'Photos', accessible: true});",
  },
  {
    module: "messages",
    name: "Messages",
    script: "const Messages = Application('Messages'); JSON.stringify({app: 'Messages', accessible: true});",
  },
  { module: "tv", name: "TV", script: "const TV = Application('TV'); JSON.stringify({app: 'TV', accessible: true});" },
];

export type SystemPermissionStatus = "granted" | "denied" | "unknown";

export interface SystemPermissionReport {
  status: SystemPermissionStatus;
  settings_path: string;
  settings_url: string;
}

/** The user copy of the TCC database always exists and is readable only with
 *  Full Disk Access, which makes it a deterministic, side-effect-free probe:
 *  a successful open proves the grant, a permission error proves its absence. */
const FULL_DISK_PROBE_PATH = join(HOME, "Library", "Application Support", "com.apple.TCC", "TCC.db");

/** The system TCC directory is visible without Full Disk Access (only its
 *  contents are vaulted). Used to disambiguate ENOENT on the user database:
 *  modern macOS data vaults hide even the *existence* of TCC.db from
 *  processes without the grant, so "file not found" there usually means
 *  "no Full Disk Access", not "no file" — unless the whole TCC layout moved,
 *  in which case this marker is gone too and we stay at "unknown". */
const TCC_VAULT_MARKER_PATH = "/Library/Application Support/com.apple.TCC";

/** Probe Full Disk Access by attempting a read-only open of a TCC-protected
 *  file. Never prompts — FDA has no consent popup to trigger. */
export async function probeFullDiskAccess(
  probePath: string = FULL_DISK_PROBE_PATH,
  vaultMarkerPath: string = TCC_VAULT_MARKER_PATH,
): Promise<SystemPermissionStatus> {
  if (process.platform !== "darwin") return "unknown";
  try {
    const handle = await open(probePath, "r");
    await handle.close();
    return "granted";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") return "denied";
    if (code === "ENOENT") {
      try {
        await stat(vaultMarkerPath);
        return "denied"; // Vault hid the database — the grant is absent.
      } catch {
        return "unknown"; // TCC layout itself is missing/relocated.
      }
    }
    return "unknown";
  }
}

/** Probe the Swift bridge for the two preflight-checkable TCC categories.
 *  Falls back to "unknown" when the bridge is missing or lacks the command
 *  (older compiled bridge) — never fails the tool over a status read. */
async function probeBridgePermissions(): Promise<{
  screen_recording: SystemPermissionStatus;
  accessibility: SystemPermissionStatus;
}> {
  try {
    if (await hasSwiftCommand("permission-status")) {
      const status = await runSwift<{ screenRecording: boolean; accessibility: boolean }>("permission-status", "{}");
      return {
        screen_recording: status.screenRecording ? "granted" : "denied",
        accessibility: status.accessibility ? "granted" : "denied",
      };
    }
  } catch {
    // Bridge crashed or timed out — report unknown rather than failing setup.
  }
  return { screen_recording: "unknown", accessibility: "unknown" };
}

function permissionReport(category: MacPermissionCategory, status: SystemPermissionStatus): SystemPermissionReport {
  const entry = MAC_PERMISSION_SETTINGS[category];
  return { status, settings_path: entry.settingsPath, settings_url: entry.settingsUrl };
}

const OPEN_SETTINGS_CHOICES = ["screen_recording", "accessibility", "full_disk", "automation"] as const;

/** Open the System Settings pane for a permission category via its
 *  x-apple.systempreferences deep link. Fire-and-forget: `open` exits
 *  immediately and System Settings comes to the foreground. */
function openSettingsPane(category: MacPermissionCategory): string {
  const url = MAC_PERMISSION_SETTINGS[category].settingsUrl;
  const child = spawn("/usr/bin/open", [url], { stdio: "ignore", detached: true });
  child.on("error", () => {
    // Swallow spawn errors — the result already carries the URL so the
    // user can open the pane manually.
  });
  child.unref();
  return url;
}

export function registerSetupTools(server: McpServer, config?: AirMcpConfig): void {
  server.registerTool(
    "setup_permissions",
    {
      title: "Setup Permissions",
      description:
        "Trigger macOS permission prompts for all Apple apps used by AirMCP and report permission status. Run this once after installation to grant all permissions at once. Each app will show a one-time macOS permission dialog. Screen Recording, Accessibility, and Full Disk Access cannot be requested with a popup — their current status is reported, and open_settings jumps straight to the System Settings pane where the user can enable them.",
      inputSchema: {
        open_settings: z
          .enum(OPEN_SETTINGS_CHOICES)
          .optional()
          .describe(
            "Open the System Settings privacy pane for this permission category so the user can grant it manually (screen_recording, accessibility, full_disk, automation).",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ open_settings }: { open_settings?: MacPermissionCategory }) => {
      // Only probe apps for enabled modules
      const apps = config ? MODULE_APP_MAP.filter((a) => isModuleEnabled(config, a.module)) : MODULE_APP_MAP;
      const results: Array<{ app: string; status: string }> = [];
      for (const app of apps) {
        try {
          await runJxa(app.script);
          results.push({ app: app.name, status: "granted" });
        } catch (e) {
          results.push({
            app: app.name,
            status: `failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      const granted = results.filter((r) => r.status === "granted").length;
      const skipped = MODULE_APP_MAP.length - apps.length;

      // Non-promptable permissions: macOS never shows a popup for these, so
      // the best setup_permissions can do is report where they stand and
      // point at the exact System Settings pane.
      const bridge = await probeBridgePermissions();
      const systemPermissions = {
        screen_recording: permissionReport("screen_recording", bridge.screen_recording),
        accessibility: permissionReport("accessibility", bridge.accessibility),
        full_disk: permissionReport("full_disk", await probeFullDiskAccess()),
      };

      const openedSettings =
        open_settings && process.platform === "darwin" ? openSettingsPane(open_settings) : undefined;

      return ok({
        total: apps.length,
        granted,
        skipped,
        results,
        system_permissions: systemPermissions,
        ...(openedSettings ? { opened_settings: openedSettings } : {}),
      });
    },
  );
}
