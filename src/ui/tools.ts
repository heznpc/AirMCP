import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { IConnectConfig } from "../shared/config.js";
import { ok, err, toolError } from "../shared/result.js";
import {
  uiOpenAppScript,
  uiClickScript,
  uiTypeScript,
  uiPressKeyScript,
  uiScrollScript,
  uiReadScript,
} from "./scripts.js";

export function registerUiTools(server: McpServer, _config: IConnectConfig): void {
  server.registerTool(
    "ui_open_app",
    {
      title: "Open App (UI Automation)",
      description:
        "Open an application by name or bundle ID and return an accessibility tree summary of its windows and top-level UI elements. Requires Accessibility permissions.",
      inputSchema: {
        appName: z.string().min(1).describe("Application name (e.g. 'Safari', 'Xcode') or bundle ID (e.g. 'com.apple.Safari')"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ appName }) => {
      try {
        return ok(await runJxa(uiOpenAppScript(appName)));
      } catch (e) {
        return toolError("open app", e);
      }
    },
  );

  server.registerTool(
    "ui_click",
    {
      title: "Click UI Element",
      description:
        "Click a UI element either by exact screen coordinates (x, y) or by searching for an element containing the given text. Optionally filter by accessibility role (e.g. 'AXButton', 'AXMenuItem', 'AXTextField'). Requires Accessibility permissions.",
      inputSchema: {
        appName: z.string().optional().describe("App name to activate before clicking. If omitted, uses the frontmost app."),
        x: z.number().optional().describe("X screen coordinate to click"),
        y: z.number().optional().describe("Y screen coordinate to click"),
        text: z.string().optional().describe("Text to search for in UI element names, descriptions, titles, and values"),
        role: z.string().optional().describe("Filter by accessibility role (e.g. 'AXButton', 'AXMenuItem', 'AXStaticText', 'AXTextField', 'AXCheckBox')"),
        index: z.number().int().min(0).optional().default(0).describe("If multiple elements match, click the one at this index (default: 0, first match)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ appName, x, y, text, role, index }) => {
      try {
        if (x === undefined && y === undefined && !text) {
          return err("Either (x, y) coordinates or text search must be provided");
        }
        if ((x !== undefined) !== (y !== undefined)) {
          return err("Both x and y coordinates must be provided together");
        }
        return ok(await runJxa(uiClickScript(appName, x, y, text, role, index)));
      } catch (e) {
        return toolError("click element", e);
      }
    },
  );

  server.registerTool(
    "ui_type",
    {
      title: "Type Text",
      description:
        "Type text into the currently focused field using simulated keystrokes via System Events. Optionally activate a specific app first. Requires Accessibility permissions.",
      inputSchema: {
        text: z.string().min(1).describe("Text to type"),
        appName: z.string().optional().describe("App name to activate before typing. If omitted, types into the frontmost app."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, appName }) => {
      try {
        return ok(await runJxa(uiTypeScript(text, appName)));
      } catch (e) {
        return toolError("type text", e);
      }
    },
  );

  server.registerTool(
    "ui_press_key",
    {
      title: "Press Key Combination",
      description:
        "Send a key or key combination (e.g. Return, Cmd+S, Ctrl+C). Supports modifier keys: command/cmd, shift, option/alt, control/ctrl. Special keys: return, enter, tab, space, delete, escape, arrow keys (up/down/left/right), F1-F12, home, end, pageup, pagedown. Requires Accessibility permissions.",
      inputSchema: {
        key: z.string().min(1).describe("Key to press — a single character (e.g. 's', 'a') or special key name (e.g. 'return', 'tab', 'escape', 'up', 'f5')"),
        modifiers: z.array(z.string()).optional().describe("Modifier keys to hold: 'command'/'cmd', 'shift', 'option'/'alt', 'control'/'ctrl'"),
        appName: z.string().optional().describe("App name to activate before pressing keys. If omitted, sends to the frontmost app."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ key, modifiers, appName }) => {
      try {
        return ok(await runJxa(uiPressKeyScript(key, modifiers, appName)));
      } catch (e) {
        return toolError("press key", e);
      }
    },
  );

  server.registerTool(
    "ui_scroll",
    {
      title: "Scroll",
      description:
        "Scroll in the specified direction within the frontmost window. Uses arrow key simulation for cross-app compatibility. Requires Accessibility permissions.",
      inputSchema: {
        direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
        amount: z.number().int().min(1).max(100).optional().default(3).describe("Number of scroll steps (default: 3)"),
        appName: z.string().optional().describe("App name to activate before scrolling. If omitted, scrolls in the frontmost app."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ direction, amount, appName }) => {
      try {
        return ok(await runJxa(uiScrollScript(direction, amount, appName)));
      } catch (e) {
        return toolError("scroll", e);
      }
    },
  );

  server.registerTool(
    "ui_read",
    {
      title: "Read Accessibility Tree",
      description:
        "Read the accessibility tree of the frontmost app (or specified app). Returns structured data about all visible UI elements including their roles, names, values, positions, and hierarchy. Use this to understand what UI elements are available before interacting with them. Requires Accessibility permissions.",
      inputSchema: {
        appName: z.string().optional().describe("App name to read. If omitted, reads the frontmost app."),
        maxDepth: z.number().int().min(1).max(10).optional().default(3).describe("Maximum depth of the UI tree to traverse (default: 3)"),
        maxElements: z.number().int().min(1).max(1000).optional().default(200).describe("Maximum number of UI elements to return (default: 200)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ appName, maxDepth, maxElements }) => {
      try {
        return ok(await runJxa(uiReadScript(appName, maxDepth, maxElements)));
      } catch (e) {
        return toolError("read UI", e);
      }
    },
  );
}
