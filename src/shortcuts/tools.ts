import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import { TIMEOUT } from "../shared/constants.js";
import { zFilePath } from "../shared/validate.js";
import {
  listShortcutsScript,
  runShortcutScript,
  searchShortcutsScript,
  getShortcutDetailScript,
  deleteShortcutScript,
  exportShortcutScript,
  importShortcutScript,
  createShortcutScript,
  duplicateShortcutScript,
  editShortcutScript,
} from "./scripts.js";

const execFileAsync = promisify(execFile);
import { LIMITS } from "../shared/constants.js";

/**
 * Sanitize a shortcut name into a valid MCP tool name.
 * MCP tool names must be alphanumeric + underscores, no spaces.
 * Returns empty string if the name sanitizes to nothing meaningful.
 */
export function sanitizeToolName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!sanitized) return "";
  return `shortcut_${sanitized}`;
}

export function registerShortcutsTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool("list_shortcuts", {
    title: "List Shortcuts",
    description: "List all available Siri Shortcuts on this Mac.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try { return ok(await runJxa(listShortcutsScript())); }
    catch (e) { return toolError("list shortcuts", e); }
  });

  server.registerTool("run_shortcut", {
    title: "Run Shortcut",
    description: "Run a Siri Shortcut by name. Optionally provide text input. Returns the shortcut's output. Note: shortcuts may trigger UI prompts or perform system actions.",
    inputSchema: {
      name: z.string().describe("Shortcut name (exact match)"),
      input: z.string().optional().describe("Optional text input for the shortcut"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ name, input }) => {
    try { return ok(await runJxa(runShortcutScript(name, input))); }
    catch (e) { return toolError("run shortcut", e); }
  });

  server.registerTool("search_shortcuts", {
    title: "Search Shortcuts",
    description: "Search Siri Shortcuts by name keyword.",
    inputSchema: {
      query: z.string().describe("Search keyword to match against shortcut names"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query }) => {
    try { return ok(await runJxa(searchShortcutsScript(query))); }
    catch (e) { return toolError("search shortcuts", e); }
  });

  server.registerTool("get_shortcut_detail", {
    title: "Get Shortcut Detail",
    description: "Get details about a Siri Shortcut including its actions.",
    inputSchema: {
      name: z.string().describe("Shortcut name (exact match)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ name }) => {
    try { return ok(await runJxa(getShortcutDetailScript(name))); }
    catch (e) { return toolError("get shortcut detail", e); }
  });

  server.registerTool("create_shortcut", {
    title: "Create Shortcut",
    description: "Create a new Siri Shortcut by name. Uses UI automation to open the Shortcuts app and create a new empty shortcut. The shortcut must be further configured in the Shortcuts app.",
    inputSchema: {
      name: z.string().describe("Name for the new shortcut"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name }) => {
    try { return ok(await runJxa(createShortcutScript(name))); }
    catch (e) { return toolError("create shortcut", e); }
  });

  server.registerTool("delete_shortcut", {
    title: "Delete Shortcut",
    description: "Delete a Siri Shortcut by name. Uses the macOS shortcuts CLI (macOS 13+). This action is permanent and cannot be undone.",
    inputSchema: {
      name: z.string().describe("Shortcut name to delete (exact match)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ name }) => {
    try { return ok(await runJxa(deleteShortcutScript(name))); }
    catch (e) { return toolError("delete shortcut", e); }
  });

  server.registerTool("export_shortcut", {
    title: "Export Shortcut",
    description: "Export a Siri Shortcut to a .shortcut file. Uses the macOS shortcuts CLI to save the shortcut to the specified output path.",
    inputSchema: {
      name: z.string().describe("Shortcut name to export (exact match)"),
      outputPath: zFilePath.describe("File path to export the .shortcut file to (e.g. ~/Desktop/MyShortcut.shortcut)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ name, outputPath }) => {
    try { return ok(await runJxa(exportShortcutScript(name, outputPath))); }
    catch (e) { return toolError("export shortcut", e); }
  });

  server.registerTool("import_shortcut", {
    title: "Import Shortcut",
    description: "Import a .shortcut file into Siri Shortcuts. Uses the macOS shortcuts CLI to import the shortcut from the specified file path.",
    inputSchema: {
      filePath: zFilePath.describe("Path to the .shortcut file to import"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ filePath }) => {
    try { return ok(await runJxa(importShortcutScript(filePath))); }
    catch (e) { return toolError("import shortcut", e); }
  });

  server.registerTool("duplicate_shortcut", {
    title: "Duplicate Shortcut",
    description: "Duplicate an existing Siri Shortcut. Exports the shortcut to a temporary file and re-imports it with a new name.",
    inputSchema: {
      name: z.string().describe("Name of the shortcut to duplicate (exact match)"),
      newName: z.string().describe("Name for the duplicated shortcut"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, newName }) => {
    try { return ok(await runJxa(duplicateShortcutScript(name, newName))); }
    catch (e) { return toolError("duplicate shortcut", e); }
  });

  server.registerTool("edit_shortcut", {
    title: "Edit Shortcut",
    description: "Open a Siri Shortcut in the Shortcuts app for manual editing. Uses UI automation (System Events) to activate the app, search for the shortcut, and open it. The user can then edit the shortcut in the Shortcuts app UI.",
    inputSchema: {
      name: z.string().describe("Shortcut name to edit (exact match)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name }) => {
    try { return ok(await runJxa(editShortcutScript(name))); }
    catch (e) { return toolError("open shortcut for editing", e); }
  });
}

/**
 * Discover user's Siri Shortcuts at startup and register each as an individual MCP tool.
 * Returns the number of dynamic tools registered. Gracefully returns 0 on failure.
 */
let cachedShortcutNames: string[] | null = null;

async function discoverShortcuts(): Promise<string[]> {
  if (cachedShortcutNames) return cachedShortcutNames;
  try {
    const result = await execFileAsync("shortcuts", ["list"], { timeout: TIMEOUT.SHORTCUTS_LIST });
    const names = result.stdout.split("\n").filter((n) => n.trim().length > 0);
    if (names.length > LIMITS.DYNAMIC_SHORTCUTS) {
      console.error(`[AirMCP] Found ${names.length} shortcuts, registering first ${LIMITS.DYNAMIC_SHORTCUTS} (limit reached)`);
    }
    cachedShortcutNames = names.slice(0, LIMITS.DYNAMIC_SHORTCUTS);
  } catch (e) {
    console.error(`[AirMCP] Failed to list shortcuts for dynamic registration: ${e instanceof Error ? e.message : String(e)}`);
    cachedShortcutNames = [];
  }
  return cachedShortcutNames;
}

export async function registerDynamicShortcutTools(server: McpServer): Promise<number> {
  const toRegister = await discoverShortcuts();
  if (toRegister.length === 0) return 0;
  const seen = new Set<string>();
  let count = 0;

  for (const name of toRegister) {
    const toolName = sanitizeToolName(name);
    if (!toolName) {
      console.error(`[AirMCP] Skipping shortcut with unsanitizable name: "${name}"`);
      continue;
    }
    if (seen.has(toolName)) {
      console.error(`[AirMCP] Skipping duplicate tool name: ${toolName} (from "${name}")`);
      continue;
    }
    seen.add(toolName);

    server.registerTool(toolName, {
      title: `Run: ${name}`,
      description: `Run the "${name}" Siri Shortcut. Optionally provide text input.`,
      inputSchema: {
        input: z.string().optional().describe("Optional text input for the shortcut"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async ({ input }) => {
      try { return ok(await runJxa(runShortcutScript(name, input))); }
      catch (e) { return toolError(`run shortcut "${name}"`, e); }
    });

    console.error(`[AirMCP] Registered dynamic shortcut: ${name}`);
    count++;
  }

  return count;
}
