import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errInvalidInput, errJxaFor } from "../shared/result.js";
import {
  uiOpenAppScript,
  uiClickScript,
  uiTypeScript,
  uiPressKeyScript,
  uiScrollScript,
  uiReadScript,
} from "./scripts.js";
import { axQueryScript, axPerformScript, axTraverseScript, axDiffScript, type AXLocator } from "./ax-query.js";

// ── Shared schemas ───────────────────────────────────────────────────
//
// The accessibility tree returned by System Events is rich and the
// JXA scripts emit fixed JSON shapes. Where the tree is recursive
// (ui_read), we use z.lazy + z.unknown() child arrays to avoid
// over-specifying — System Events can return arbitrary AX roles and
// attributes, and AXAttribute names are open-ended (each macOS app /
// SwiftUI version can introduce new ones), so we don't enumerate them.

// 2D point/size as returned by AX (always a tuple of two numbers, or
// null when the element doesn't expose position/size).
const axPointSchema = z.array(z.number()).length(2).nullable();
const axSizeSchema = z.array(z.number()).length(2).nullable();

// Element summary (role + title + description) emitted by uiOpenAppScript
// for top-level window elements.
const uiElementSummarySchema = z.object({
  role: z.string(),
  title: z.string(),
  description: z.string(),
});

// Window info emitted by uiOpenAppScript.
const uiWindowInfoSchema = z.object({
  title: z.string(),
  role: z.string(),
  size: axSizeSchema,
  position: axPointSchema,
  elementSummary: z.array(uiElementSummarySchema),
});

// Recursive AX tree node emitted by uiReadScript. `children` is typed
// as z.unknown() because the tree depth is bounded only by maxDepth
// (1..10) and z.lazy() recursion blows up type inference at the schema
// level — keeping children as unknown lets the schema document the
// shape without pinning a TS-recursive type. Callers should treat
// children as the same node shape at runtime.
const uiTreeNodeSchema = z.object({
  role: z.string(),
  name: z.string(),
  title: z.string(),
  value: z.string(),
  description: z.string(),
  enabled: z.boolean().nullable(),
  focused: z.boolean().nullable(),
  position: axPointSchema,
  size: axSizeSchema,
  // Recursive structure: same shape as uiTreeNodeSchema. Modelled as
  // z.unknown() so the schema stays acyclic at the type level; the
  // runtime payload is well-formed because the JXA script enforces
  // it via maxDepth/maxElements.
  children: z.array(z.unknown()),
});

// Menu-bar item emitted by uiReadScript.
const uiMenuItemSchema = z.object({
  title: z.string(),
  name: z.string(),
});

// Element shape returned by axQueryScript (rich, flat, no children).
const axQueryElementSchema = z.object({
  index: z.number().int(),
  path: z.string(),
  role: z.string(),
  name: z.string(),
  title: z.string(),
  value: z.string(),
  description: z.string(),
  identifier: z.string(),
  position: axPointSchema,
  size: axSizeSchema,
  enabled: z.boolean().nullable(),
  focused: z.boolean().nullable(),
});

// Node shape returned by axTraverseScript (BFS flat list with parentId
// links). selected may be true/false/null depending on whether the AX
// element supports the selected attribute.
const axTraverseNodeSchema = z.object({
  id: z.number().int(),
  parentId: z.number().int().nullable(),
  depth: z.number().int(),
  role: z.string(),
  name: z.string(),
  title: z.string(),
  value: z.string(),
  description: z.string(),
  identifier: z.string(),
  position: axPointSchema,
  size: axSizeSchema,
  enabled: z.boolean().nullable(),
  focused: z.boolean().nullable(),
  selected: z.boolean().nullable(),
  childCount: z.number().int(),
});

// Diff change entry emitted by axDiffScript. `type` is one of
// added/removed/changed; before/after only present on "changed",
// value only present on "added". Modelled as a discriminated-ish
// permissive shape because the script emits a mixed payload.
const axDiffChangeSchema = z.object({
  type: z.enum(["added", "removed", "changed"]),
  path: z.string(),
  value: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
});

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
      // Window titles and element labels come from user-controlled apps
      // — untrusted markers applied via okUntrustedStructured.
      outputSchema: {
        activated: z.literal(true),
        name: z.string(),
        bundleIdentifier: z.string().nullable(),
        pid: z.number().int(),
        windowCount: z.number().int(),
        windows: z.array(uiWindowInfoSchema),
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
        const result = (await runJxa(uiOpenAppScript(appName))) as {
          activated: true;
          name: string;
          bundleIdentifier: string | null;
          pid: number;
          windowCount: number;
          windows: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("open app", e);
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
      // Two distinct shapes: coordinate-click vs text-search click. We
      // model both fields as optional so the schema covers both branches
      // without needing a discriminated union (the JXA script picks one).
      // method is "coordinate" or "text_search". `element.name/role`
      // come from the AX tree (user-controlled), so the response is
      // wrapped with untrusted markers.
      outputSchema: {
        clicked: z.literal(true),
        method: z.enum(["coordinate", "text_search"]),
        x: z.number().optional(),
        y: z.number().optional(),
        matchCount: z.number().int().optional(),
        selectedIndex: z.number().int().optional(),
        element: z
          .object({
            name: z.string(),
            role: z.string(),
          })
          .optional(),
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
        const result = (await runJxa(uiClickScript(appName, x, y, text, role, index))) as {
          clicked: true;
          method: "coordinate" | "text_search";
          x?: number;
          y?: number;
          matchCount?: number;
          selectedIndex?: number;
          element?: { name: string; role: string };
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("click element", e);
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
      // length echoes input.text.length — no untrusted content.
      outputSchema: {
        typed: z.literal(true),
        length: z.number().int(),
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
        const result = (await runJxa(uiTypeScript(text, appName))) as { typed: true; length: number };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("type text", e);
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
      // keyCode is only emitted when the key is a special-name mapping;
      // for raw characters the script omits it. key echoes the input.
      outputSchema: {
        pressed: z.literal(true),
        key: z.string(),
        keyCode: z.number().int().optional(),
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
        const result = (await runJxa(uiPressKeyScript(key, modifiers, appName))) as {
          pressed: true;
          key: string;
          keyCode?: number;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("press key", e);
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
      // direction/amount echo the input — no untrusted content.
      outputSchema: {
        scrolled: z.literal(true),
        direction: z.string(),
        amount: z.number().int(),
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
        const result = (await runJxa(uiScrollScript(direction, amount, appName))) as {
          scrolled: true;
          direction: string;
          amount: number;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("scroll", e);
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
      // windows contains recursive AX tree nodes (see uiTreeNodeSchema
      // comment). Tree depth bounded by maxDepth; element strings are
      // user-controlled — wrapped untrusted.
      outputSchema: {
        app: z.string(),
        bundleIdentifier: z.string().nullable(),
        windowCount: z.number().int(),
        elementCount: z.number().int(),
        truncated: z.boolean(),
        maxDepth: z.number().int(),
        windows: z.array(uiTreeNodeSchema),
        menuBar: z.array(uiMenuItemSchema),
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
        const result = (await runJxa(uiReadScript(appName, maxDepth, maxElements))) as {
          app: string;
          bundleIdentifier: string | null;
          windowCount: number;
          elementCount: number;
          truncated: boolean;
          maxDepth: number;
          windows: Array<unknown>;
          menuBar: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("read UI", e);
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
      // query echoes the input locator (free-form attribute map — we
      // use z.record because identifiers and labels are caller-supplied
      // strings and the locator shape may evolve). elements is a flat
      // list of matched AX elements; their text fields are
      // user-controlled, so the payload is wrapped untrusted.
      outputSchema: {
        app: z.string(),
        pid: z.number().int(),
        query: z.record(z.string(), z.unknown()),
        matchCount: z.number().int(),
        visited: z.number().int(),
        elements: z.array(axQueryElementSchema),
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
        const result = (await runJxa(axQueryScript(locator, maxResults, maxDepth))) as {
          app: string;
          pid: number;
          query: Record<string, unknown>;
          matchCount: number;
          visited: number;
          elements: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("accessibility query", e);
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
      // result is a free-form action-result string ("clicked", "value
      // set", "menu shown", or "<actionName> performed"). element is
      // the AX element the action was applied to — user-controlled.
      outputSchema: {
        action: z.string(),
        result: z.string(),
        element: axQueryElementSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ app, role, title, value, description, identifier, label, action, actionValue, index }) => {
      try {
        if (!role && !title && !value && !description && !identifier && !label) {
          return errInvalidInput("At least one search criterion is required to locate the element.");
        }
        const locator: AXLocator = { app, role, title, value, description, identifier, label };
        const result = (await runJxa(axPerformScript(locator, action, actionValue, index))) as {
          action: string;
          result: string;
          element: unknown;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("perform action", e);
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
      // Flat node list — parentId links nodes by id rather than nesting,
      // so the schema is non-recursive. AX element text is
      // user-controlled — payload wrapped untrusted.
      outputSchema: {
        app: z.string(),
        pid: z.number().int(),
        bundleId: z.string().nullable(),
        totalElements: z.number().int(),
        maxDepth: z.number().int(),
        truncated: z.boolean(),
        elements: z.array(axTraverseNodeSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ app, pid, maxDepth, maxElements, onlyVisible }) => {
      try {
        const result = (await runJxa(axTraverseScript(app, pid, maxDepth, maxElements, onlyVisible))) as {
          app: string;
          pid: number;
          bundleId: string | null;
          totalElements: number;
          maxDepth: number;
          truncated: boolean;
          elements: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("traverse UI", e);
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
      // changes carries before/after AX values (user-controlled text)
      // for each diff entry — payload wrapped untrusted.
      outputSchema: {
        app: z.string(),
        changeCount: z.number().int(),
        changes: z.array(axDiffChangeSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ beforeSnapshot, app }) => {
      try {
        const result = (await runJxa(axDiffScript(beforeSnapshot, app))) as {
          app: string;
          changeCount: number;
          changes: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("UI diff", e);
      }
    },
  );
}
