import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import { runAutomation } from "../shared/automation.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, toolError } from "../shared/result.js";
import { zFilePath } from "../shared/validate.js";
import {
  getClipboardScript,
  setClipboardScript,
  getVolumeScript,
  setVolumeScript,
  toggleDarkModeScript,
  getFrontmostAppScript,
  listRunningAppsScript,
  getScreenInfoScript,
  showNotificationScript,
  captureScreenshotScript,
  getWifiStatusScript,
  toggleWifiScript,
  listBluetoothDevicesScript,
  getBatteryStatusScript,
  getBrightnessScript,
  setBrightnessScript,
  toggleFocusModeScript,
  systemSleepScript,
  preventSleepScript,
  systemPowerScript,
  launchAppScript,
  quitAppScript,
  isAppRunningScript,
  listAllWindowsScript,
  moveWindowScript,
  resizeWindowScript,
  minimizeWindowScript,
} from "./scripts.js";

let caffeinatePid: number | null = null;

// Clean up orphaned caffeinate process on server exit
process.on("exit", () => {
  if (caffeinatePid !== null) {
    try { process.kill(caffeinatePid); } catch { /* already exited */ }
  }
});

export function registerSystemTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "get_clipboard",
    {
      title: "Get Clipboard",
      description: "Read the current text content of the system clipboard.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return okUntrusted(
          await runAutomation<{ content: string; length: number; truncated: boolean }>({
            swift: { command: "get-clipboard" },
            jxa: () => getClipboardScript(),
          }),
        );
      } catch (e) {
        return toolError("get clipboard", e);
      }
    },
  );

  server.registerTool(
    "set_clipboard",
    {
      title: "Set Clipboard",
      description: "Write text to the system clipboard, replacing its current content.",
      inputSchema: {
        text: z.string().describe("Text to copy to the clipboard"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ text }) => {
      try {
        return ok(await runJxa<{ set: boolean; length: number }>(setClipboardScript(text)));
      } catch (e) {
        return toolError("set clipboard", e);
      }
    },
  );

  server.registerTool(
    "get_volume",
    {
      title: "Get Volume",
      description: "Get the current system output volume level and mute state.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa<{ outputVolume: number; inputVolume: number; outputMuted: boolean }>(getVolumeScript()));
      } catch (e) {
        return toolError("get volume", e);
      }
    },
  );

  server.registerTool(
    "set_volume",
    {
      title: "Set Volume",
      description: "Set the system output volume (0-100) and/or mute state.",
      inputSchema: {
        volume: z.number().min(0).max(100).optional().describe("Output volume level (0-100)"),
        muted: z.boolean().optional().describe("Whether to mute output audio"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ volume, muted }) => {
      try {
        return ok(await runJxa<{ outputVolume: number; outputMuted: boolean }>(setVolumeScript(volume, muted)));
      } catch (e) {
        return toolError("set volume", e);
      }
    },
  );

  server.registerTool(
    "toggle_dark_mode",
    {
      title: "Toggle Dark Mode",
      description: "Toggle macOS appearance between dark mode and light mode.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa<{ darkMode: boolean }>(toggleDarkModeScript()));
      } catch (e) {
        return toolError("toggle dark mode", e);
      }
    },
  );

  server.registerTool(
    "get_frontmost_app",
    {
      title: "Get Frontmost App",
      description: "Get the name, bundle identifier, and PID of the currently active (frontmost) application.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa<{ name: string; bundleIdentifier: string; pid: number }>(getFrontmostAppScript()));
      } catch (e) {
        return toolError("get frontmost app", e);
      }
    },
  );

  server.registerTool(
    "list_running_apps",
    {
      title: "List Running Apps",
      description: "List all running applications with name, bundle identifier, PID, and visibility.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa(listRunningAppsScript()));
      } catch (e) {
        return toolError("list running apps", e);
      }
    },
  );

  server.registerTool(
    "get_screen_info",
    {
      title: "Get Screen Info",
      description: "Get display information including resolution, pixel dimensions, and Retina status.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa(getScreenInfoScript()));
      } catch (e) {
        return toolError("get screen info", e);
      }
    },
  );

  server.registerTool(
    "show_notification",
    {
      title: "Show Notification",
      description: "Display a macOS system notification with optional title, subtitle, and sound.",
      inputSchema: {
        message: z.string().describe("Notification body text"),
        title: z.string().optional().describe("Notification title"),
        subtitle: z.string().optional().describe("Notification subtitle"),
        sound: z.string().optional().describe("Sound name to play (e.g. 'Frog', 'Glass', 'Hero')"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ message, title, subtitle, sound }) => {
      try {
        return ok(await runJxa(showNotificationScript(message, title, subtitle, sound)));
      } catch (e) {
        return toolError("show notification", e);
      }
    },
  );

  server.registerTool(
    "capture_screenshot",
    {
      title: "Capture Screenshot",
      description: "Take a screenshot and save to the specified path. Supports full screen, window, or selection capture.",
      inputSchema: {
        path: zFilePath.describe("Absolute file path to save the screenshot (e.g. '/tmp/screenshot.png')"),
        region: z.enum(["fullscreen", "window", "selection"]).optional().default("fullscreen").describe("Capture region: fullscreen (default), window, or selection"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, region }) => {
      try {
        return ok(await runJxa(captureScreenshotScript(path, region)));
      } catch (e) {
        return toolError("capture screenshot", e);
      }
    },
  );

  // --- Network & Display Control Tools ---

  server.registerTool(
    "get_wifi_status",
    {
      title: "Get WiFi Status",
      description: "Get the current WiFi status including connected network name, signal strength, and channel.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa(getWifiStatusScript()));
      } catch (e) {
        return toolError("get wifi status", e);
      }
    },
  );

  server.registerTool(
    "toggle_wifi",
    {
      title: "Toggle WiFi",
      description: "Turn WiFi on or off.",
      inputSchema: {
        enable: z.boolean().describe("True to enable WiFi, false to disable"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ enable }) => {
      try {
        return ok(await runJxa(toggleWifiScript(enable)));
      } catch (e) {
        return toolError("toggle wifi", e);
      }
    },
  );

  server.registerTool(
    "list_bluetooth_devices",
    {
      title: "List Bluetooth Devices",
      description: "List paired Bluetooth devices with their connection status.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa(listBluetoothDevicesScript()));
      } catch (e) {
        return toolError("list bluetooth devices", e);
      }
    },
  );

  server.registerTool(
    "get_battery_status",
    {
      title: "Get Battery Status",
      description: "Get battery percentage, charging state, power source, and estimated time remaining.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa(getBatteryStatusScript()));
      } catch (e) {
        return toolError("get battery status", e);
      }
    },
  );

  server.registerTool(
    "get_brightness",
    {
      title: "Get Brightness",
      description: "Get the current display brightness level.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa(getBrightnessScript()));
      } catch (e) {
        return toolError("get brightness", e);
      }
    },
  );

  server.registerTool(
    "set_brightness",
    {
      title: "Set Brightness",
      description: "Set the display brightness level. Requires the 'brightness' CLI tool (brew install brightness).",
      inputSchema: {
        level: z.number().min(0).max(1).describe("Brightness level from 0.0 (darkest) to 1.0 (brightest)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ level }) => {
      try {
        return ok(await runJxa(setBrightnessScript(level)));
      } catch (e) {
        return toolError("set brightness", e);
      }
    },
  );

  server.registerTool(
    "toggle_focus_mode",
    {
      title: "Toggle Focus Mode",
      description: "Toggle Do Not Disturb (Focus mode) on or off.",
      inputSchema: {
        enable: z.boolean().describe("True to enable Do Not Disturb, false to disable"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ enable }) => {
      try {
        return ok(await runJxa(toggleFocusModeScript(enable)));
      } catch (e) {
        return toolError("toggle focus mode", e);
      }
    },
  );

  // --- Sleep & Power Management Tools ---

  server.registerTool(
    "system_sleep",
    {
      title: "System Sleep",
      description: "Put the Mac to sleep.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runJxa<{ action: string; success: boolean }>(systemSleepScript()));
      } catch (e) {
        return toolError("system sleep", e);
      }
    },
  );

  server.registerTool(
    "prevent_sleep",
    {
      title: "Prevent Sleep",
      description: "Prevent the Mac from sleeping for a specified duration using caffeinate. Returns the process PID for cancellation.",
      inputSchema: {
        seconds: z.number().int().min(1).max(86400).optional().default(3600).describe("Duration in seconds (default: 3600 = 1 hour, max: 86400 = 24 hours)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ seconds }) => {
      try {
        // Kill any previous caffeinate process before starting a new one
        if (caffeinatePid !== null) {
          try { process.kill(caffeinatePid); } catch { /* already exited */ }
          caffeinatePid = null;
        }
        const result = await runJxa<{ action: string; pid: number; seconds: number }>(preventSleepScript(seconds));
        caffeinatePid = result.pid;
        return ok(result);
      } catch (e) {
        return toolError("prevent sleep", e);
      }
    },
  );

  server.registerTool(
    "system_power",
    {
      title: "System Power",
      description: "Shutdown or restart the Mac. Use with caution.",
      inputSchema: {
        action: z.enum(["shutdown", "restart"]).describe("Power action: shutdown or restart"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ action }) => {
      try {
        return ok(await runJxa<{ action: string; success: boolean }>(systemPowerScript(action)));
      } catch (e) {
        return toolError("system power", e);
      }
    },
  );

  // --- App Management Tools ---

  server.registerTool(
    "launch_app",
    {
      title: "Launch App",
      description: "Launch an application by name. Lightweight — just activates the app without reading its accessibility tree.",
      inputSchema: {
        name: z.string().min(1).describe("Application name (e.g. 'Safari', 'Xcode') or bundle ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        return ok(await runJxa(launchAppScript(name)));
      } catch (e) {
        return toolError("launch app", e);
      }
    },
  );

  server.registerTool(
    "quit_app",
    {
      title: "Quit App",
      description: "Quit a running application by name. May cause unsaved work to be lost.",
      inputSchema: {
        name: z.string().min(1).describe("Application name (e.g. 'Safari')"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        return ok(await runJxa(quitAppScript(name)));
      } catch (e) {
        return toolError("quit app", e);
      }
    },
  );

  server.registerTool(
    "is_app_running",
    {
      title: "Is App Running",
      description: "Check whether an application is currently running. Returns process details if found.",
      inputSchema: {
        name: z.string().min(1).describe("Application name to check (e.g. 'Safari')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        return ok(await runJxa(isAppRunningScript(name)));
      } catch (e) {
        return toolError("check app running", e);
      }
    },
  );

  // --- Window Management Tools ---

  server.registerTool(
    "list_all_windows",
    {
      title: "List All Windows",
      description: "List windows across all running applications with title, size, position, app name, and PID.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listAllWindowsScript()));
      } catch (e) {
        return toolError("list all windows", e);
      }
    },
  );

  server.registerTool(
    "move_window",
    {
      title: "Move Window",
      description: "Move a window to a specific position on screen.",
      inputSchema: {
        appName: z.string().min(1).describe("Application name (e.g. 'Safari')"),
        x: z.number().int().describe("X coordinate for top-left corner"),
        y: z.number().int().describe("Y coordinate for top-left corner"),
        windowTitle: z.string().optional().describe("Specific window title. If omitted, targets the first window."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ appName, x, y, windowTitle }) => {
      try {
        return ok(await runJxa(moveWindowScript(appName, x, y, windowTitle)));
      } catch (e) {
        return toolError("move window", e);
      }
    },
  );

  server.registerTool(
    "resize_window",
    {
      title: "Resize Window",
      description: "Resize a window to specific dimensions.",
      inputSchema: {
        appName: z.string().min(1).describe("Application name (e.g. 'Safari')"),
        width: z.number().int().min(1).describe("Window width in pixels"),
        height: z.number().int().min(1).describe("Window height in pixels"),
        windowTitle: z.string().optional().describe("Specific window title. If omitted, targets the first window."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ appName, width, height, windowTitle }) => {
      try {
        return ok(await runJxa(resizeWindowScript(appName, width, height, windowTitle)));
      } catch (e) {
        return toolError("resize window", e);
      }
    },
  );

  server.registerTool(
    "minimize_window",
    {
      title: "Minimize Window",
      description: "Minimize or restore a window.",
      inputSchema: {
        appName: z.string().min(1).describe("Application name (e.g. 'Safari')"),
        restore: z.boolean().optional().default(false).describe("Set true to restore (un-minimize) instead of minimizing"),
        windowTitle: z.string().optional().describe("Specific window title. If omitted, targets the first window."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ appName, restore, windowTitle }) => {
      try {
        return ok(await runJxa(minimizeWindowScript(appName, restore, windowTitle)));
      } catch (e) {
        return toolError("minimize window", e);
      }
    },
  );
}
