import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, errInvalidInput, toolError } from "../shared/result.js";
import {
  uiOpenAppScript,
  uiClickScript,
  uiTypeScript,
  uiPressKeyScript,
  uiScrollScript,
  uiReadScript,
} from "./scripts.js";
import { axQueryScript, axPerformScript, axTraverseScript, axDiffScript, type AXLocator } from "./ax-query.js";

export function registerUiTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "ui_open_app",
    {
      title: "Open App (UI Automation)",
      description:
        "Open an application by name or bundle ID and return an accessibility tree summary of its windows and top-level UI elements. Requires Accessibility permissions.",
      inputSchema: {
        appName: z
          .string()
          .min(1)
          .describe("Application name (e.g. 'Safari', 'Xcode') or bundle ID (e.g. 'com.apple.Safari')"),
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
        return okUntrusted(await runJxa(uiOpenAppScript(appName)));
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
        appName: z
          .string()
          .optional()
          .describe("App name to activate before clicking. If omitted, uses the frontmost app."),
        x: z.number().optional().describe("X screen coordinate to click"),
        y: z.number().optional().describe("Y screen coordinate to click"),
        text: z
          .string()
          .optional()
          .describe("Text to search for in UI element names, descriptions, titles, and values"),
        role: z
          .string()
          .optional()
          .describe(
            "Filter by accessibility role (e.g. 'AXButton', 'AXMenuItem', 'AXStaticText', 'AXTextField', 'AXCheckBox')",
          ),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("If multiple elements match, click the one at this index (default: 0, first match)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ appName, x, y, text, role, index }) => {
      try {
        if (x === undefined && y === undefined && !text) {
          return errInvalidInput("Either (x, y) coordinates or text search must be provided");
        }
        if ((x !== undefined) !== (y !== undefined)) {
          return errInvalidInput("Both x and y coordinates must be provided together");
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
        text: z.string().min(1).max(10000).describe("Text to type"),
        appName: z
          .string()
          .optional()
          .describe("App name to activate before typing. If omitted, types into the frontmost app."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
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
        key: z
          .string()
          .min(1)
          .describe(
            "Key to press — a single character (e.g. 's', 'a') or special key name (e.g. 'return', 'tab', 'escape', 'up', 'f5')",
          ),
        modifiers: z
          .array(z.string())
          .optional()
          .describe("Modifier keys to hold: 'command'/'cmd', 'shift', 'option'/'alt', 'control'/'ctrl'"),
        appName: z
          .string()
          .optional()
          .describe("App name to activate before pressing keys. If omitted, sends to the frontmost app."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
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
        appName: z
          .string()
          .optional()
          .describe("App name to activate before scrolling. If omitted, scrolls in the frontmost app."),
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
        appName: z.string().max(500).optional().describe("App name to read. If omitted, reads the frontmost app."),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(3)
          .describe("Maximum depth of the UI tree to traverse (default: 3)"),
        maxElements: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(200)
          .describe("Maximum number of UI elements to return (default: 200)"),
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
        return okUntrusted(await runJxa(uiReadScript(appName, maxDepth, maxElements)));
      } catch (e) {
        return toolError("read UI", e);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // Phase 1: Accessibility Query (steipete pattern)
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "ui_accessibility_query",
    {
      title: "Query UI Elements",
      description:
        "Search for UI elements by accessibility attributes (role, title, value, description, identifier). " +
        "More precise than ui_read — returns only matching elements with full attribute data. " +
        "Works on any app, including those without AppleScript support. Requires Accessibility permissions.",
      inputSchema: {
        app: z.string().max(500).optional().describe("App name to search in. If omitted, uses frontmost app."),
        role: z
          .string()
          .optional()
          .describe(
            "AX role filter (e.g. 'AXButton', 'AXTextField', 'AXMenuItem', 'AXStaticText', 'AXCheckBox', 'AXPopUpButton')",
          ),
        title: z.string().max(500).optional().describe("Title text to match (substring, case-insensitive)"),
        value: z.string().max(10000).optional().describe("Value text to match (substring, case-insensitive)"),
        description: z.string().max(5000).optional().describe("Description text to match (substring)"),
        identifier: z.string().max(1000).optional().describe("AXIdentifier to match (exact)"),
        label: z
          .string()
          .optional()
          .describe("General label search — matches across name, title, value, and description"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Max results to return (default: 20)"),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .default(8)
          .describe("Max tree depth to search (default: 8)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ app, role, title, value, description, identifier, label, maxResults, maxDepth }) => {
      try {
        if (!role && !title && !value && !description && !identifier && !label) {
          return errInvalidInput(
            "At least one search criterion (role, title, value, description, identifier, or label) is required.",
          );
        }
        const locator: AXLocator = { app, role, title, value, description, identifier, label };
        return okUntrusted(await runJxa(axQueryScript(locator, maxResults, maxDepth)));
      } catch (e) {
        return toolError("accessibility query", e);
      }
    },
  );

  server.registerTool(
    "ui_perform_action",
    {
      title: "Perform Action on UI Element",
      description:
        "Find a UI element by locator (role + title/value) and perform an accessibility action on it. " +
        "Actions: press (click), pick (select), confirm, setValue, raise (focus), showMenu. " +
        "Combines query + action in one step. Requires Accessibility permissions.",
      inputSchema: {
        app: z.string().max(500).optional().describe("App name"),
        role: z.string().max(500).optional().describe("AX role filter"),
        title: z.string().max(500).optional().describe("Title text to match"),
        value: z.string().max(10000).optional().describe("Value text to match"),
        description: z.string().max(5000).optional().describe("Description text to match"),
        identifier: z.string().max(1000).optional().describe("AXIdentifier exact match"),
        label: z.string().max(500).optional().describe("General label search"),
        action: z
          .enum([
            "press",
            "click",
            "pick",
            "select",
            "confirm",
            "setValue",
            "set",
            "raise",
            "focus",
            "showMenu",
            "AXPress",
            "AXPick",
            "AXConfirm",
            "AXSetValue",
            "AXRaise",
            "AXShowMenu",
          ])
          .describe("Action to perform"),
        actionValue: z.string().max(10000).optional().describe("Value to set (for setValue action)"),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("If multiple matches, act on element at this index (default: 0)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ app, role, title, value, description, identifier, label, action, actionValue, index }) => {
      try {
        if (!role && !title && !value && !description && !identifier && !label) {
          return errInvalidInput("At least one search criterion is required to locate the element.");
        }
        const locator: AXLocator = { app, role, title, value, description, identifier, label };
        return ok(await runJxa(axPerformScript(locator, action, actionValue, index)));
      } catch (e) {
        return toolError("perform action", e);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // Phase 2: BFS Traverse + Diff (mediar-ai pattern)
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "ui_traverse",
    {
      title: "BFS Traverse UI Tree",
      description:
        "Breadth-first traversal of the accessibility tree. Returns a flat list of all UI elements " +
        "with parent-child relationships, positions, sizes, and states. Supports PID targeting and " +
        "visible-only filtering. More thorough than ui_read. Requires Accessibility permissions.",
      inputSchema: {
        app: z.string().max(500).optional().describe("App name to traverse. If omitted, uses frontmost app."),
        pid: z.number().int().optional().describe("Process ID for precise targeting (overrides app name lookup)"),
        maxDepth: z.number().int().min(1).max(15).optional().default(5).describe("Max traversal depth (default: 5)"),
        maxElements: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .default(500)
          .describe("Max elements to collect (default: 500)"),
        onlyVisible: z.boolean().optional().default(false).describe("Only include elements with visible position/size"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ app, pid, maxDepth, maxElements, onlyVisible }) => {
      try {
        return okUntrusted(await runJxa(axTraverseScript(app, pid, maxDepth, maxElements, onlyVisible)));
      } catch (e) {
        return toolError("traverse UI", e);
      }
    },
  );

  server.registerTool(
    "ui_diff",
    {
      title: "Compare UI State",
      description:
        "Compare the current UI state against a previous snapshot to detect changes. " +
        "Pass the 'elements' array from a previous ui_traverse result as beforeSnapshot. " +
        "Returns added, removed, and changed elements. Useful for verifying action results.",
      inputSchema: {
        beforeSnapshot: z
          .string()
          .min(1)
          .max(500000)
          .describe("JSON string of previous UI tree snapshot (elements array from ui_traverse)"),
        app: z.string().max(500).optional().describe("App name to compare against"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ beforeSnapshot, app }) => {
      try {
        return okUntrusted(await runJxa(axDiffScript(beforeSnapshot, app)));
      } catch (e) {
        return toolError("UI diff", e);
      }
    },
  );
}
