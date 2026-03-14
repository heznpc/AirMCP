import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
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
} from "./scripts.js";

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
        return ok(await runJxa<{ content: string }>(getClipboardScript()));
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
        path: z.string().min(1).describe("Absolute file path to save the screenshot (e.g. '/tmp/screenshot.png')"),
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
        destructiveHint: false,
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
}
