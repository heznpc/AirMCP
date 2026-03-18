import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, err, toolError } from "../shared/result.js";
import {
  listTabsScript,
  readPageContentScript,
  getCurrentTabScript,
  openUrlScript,
  closeTabScript,
  activateTabScript,
  runJavascriptScript,
  searchTabsScript,
  listBookmarksScript,
  listReadingListScript,
  addToReadingListScript,
} from "./scripts.js";

export function registerSafariTools(server: McpServer, config: AirMcpConfig): void {
  const { allowRunJavascript } = config;
  server.registerTool(
    "list_tabs",
    {
      title: "List Safari Tabs",
      description: "List all open tabs across all Safari windows with title and URL.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listTabsScript()));
      } catch (e) {
        return toolError("list tabs", e);
      }
    },
  );

  server.registerTool(
    "read_page_content",
    {
      title: "Read Page Content",
      description: "Read the HTML source of a Safari tab. Specify window and tab index from list_tabs.",
      inputSchema: {
        windowIndex: z.number().int().min(0).optional().default(0).describe("Window index (default: 0)"),
        tabIndex: z.number().int().min(0).optional().default(0).describe("Tab index (default: 0)"),
        maxLength: z.number().int().min(100).max(50000).optional().default(10000).describe("Max content length (default: 10000)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ windowIndex, tabIndex, maxLength }) => {
      try {
        return okUntrusted(await runJxa(readPageContentScript(windowIndex, tabIndex, maxLength)));
      } catch (e) {
        return toolError("read page", e);
      }
    },
  );

  server.registerTool(
    "get_current_tab",
    {
      title: "Get Current Tab",
      description: "Get the title and URL of the active Safari tab.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(getCurrentTabScript()));
      } catch (e) {
        return toolError("get current tab", e);
      }
    },
  );

  server.registerTool(
    "open_url",
    {
      title: "Open URL",
      description: "Open a URL in Safari's frontmost window.",
      inputSchema: {
        url: z.string().url().describe("URL to open"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      try {
        return ok(await runJxa(openUrlScript(url)));
      } catch (e) {
        return toolError("open URL", e);
      }
    },
  );

  server.registerTool(
    "close_tab",
    {
      title: "Close Tab",
      description: "Close a specific Safari tab. Use list_tabs to find window/tab indices.",
      inputSchema: {
        windowIndex: z.number().int().min(0).optional().default(0).describe("Window index (default: 0)"),
        tabIndex: z.number().int().min(0).describe("Tab index"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ windowIndex, tabIndex }) => {
      try {
        return ok(await runJxa(closeTabScript(windowIndex, tabIndex)));
      } catch (e) {
        return toolError("close tab", e);
      }
    },
  );

  server.registerTool(
    "activate_tab",
    {
      title: "Activate Tab",
      description: "Switch to a specific Safari tab. Use list_tabs to find window/tab indices.",
      inputSchema: {
        windowIndex: z.number().int().min(0).optional().default(0).describe("Window index (default: 0)"),
        tabIndex: z.number().int().min(0).describe("Tab index"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ windowIndex, tabIndex }) => {
      try {
        return ok(await runJxa(activateTabScript(windowIndex, tabIndex)));
      } catch (e) {
        return toolError("activate tab", e);
      }
    },
  );

  server.registerTool(
    "run_javascript",
    {
      title: "Run JavaScript",
      description: "Execute JavaScript in a Safari tab. Use list_tabs to find window/tab indices. Returns the result as a string.",
      inputSchema: {
        code: z.string().describe("JavaScript to execute"),
        windowIndex: z.number().int().min(0).optional().default(0).describe("Window index (default: 0)"),
        tabIndex: z.number().int().min(0).optional().default(0).describe("Tab index (default: 0)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ code, windowIndex, tabIndex }) => {
      if (!allowRunJavascript) return err("Running JavaScript in Safari is disabled. Set AIRMCP_ALLOW_RUN_JAVASCRIPT=true or allowRunJavascript in config.json.");
      try {
        return ok(await runJxa(runJavascriptScript(code, windowIndex, tabIndex)));
      } catch (e) {
        return toolError("run JavaScript", e);
      }
    },
  );

  server.registerTool(
    "search_tabs",
    {
      title: "Search Tabs",
      description: "Search open Safari tabs by title or URL keyword.",
      inputSchema: {
        query: z.string().describe("Search keyword to match against tab titles and URLs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        return ok(await runJxa(searchTabsScript(query)));
      } catch (e) {
        return toolError("search tabs", e);
      }
    },
  );

  server.registerTool(
    "list_bookmarks",
    {
      title: "List Bookmarks",
      description: "List all Safari bookmarks across all folders, including subfolder paths.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listBookmarksScript()));
      } catch (e) {
        return toolError("list bookmarks", e);
      }
    },
  );

  server.registerTool(
    "add_bookmark",
    {
      title: "Add Bookmark (Deprecated)",
      description:
        "DEPRECATED: Safari removed bookmark scripting in macOS 26. This tool will return an error. " +
        "Use add_to_reading_list instead, which still works.",
      inputSchema: {
        url: z.string().url().describe("URL to bookmark"),
        title: z.string().describe("Bookmark title"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      return err(
        "add_bookmark is deprecated — Safari removed bookmark scripting in macOS 26. " +
        "Use add_to_reading_list instead."
      );
    },
  );

  server.registerTool(
    "list_reading_list",
    {
      title: "List Reading List",
      description: "List all items in Safari's Reading List.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listReadingListScript()));
      } catch (e) {
        return toolError("list reading list", e);
      }
    },
  );

  server.registerTool(
    "add_to_reading_list",
    {
      title: "Add to Reading List",
      description: "Add a URL to Safari's Reading List with an optional title.",
      inputSchema: {
        url: z.string().url().describe("URL to add to Reading List"),
        title: z.string().optional().describe("Title for the Reading List item"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ url, title }) => {
      try {
        return ok(await runJxa(addToReadingListScript(url, title)));
      } catch (e) {
        return toolError("add to reading list", e);
      }
    },
  );
}
