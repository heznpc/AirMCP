import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import {
  ok,
  okUntrusted,
  okUntrustedStructured,
  okUntrustedLinkedStructured,
  err,
  toolError,
} from "../shared/result.js";
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
      outputSchema: {
        tabs: z.array(
          z.object({
            windowIndex: z.number(),
            tabIndex: z.number(),
            title: z.string(),
            url: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrustedLinkedStructured("list_tabs", await runJxa(listTabsScript()));
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
        maxLength: z
          .number()
          .int()
          .min(100)
          .max(50000)
          .optional()
          .default(10000)
          .describe("Max content length (default: 10000)"),
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
      outputSchema: {
        title: z.string(),
        url: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrustedStructured(await runJxa(getCurrentTabScript()));
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
      // Block non-HTTP schemes and internal network addresses to prevent the
      // LLM caller from using Safari + read_page_content to exfiltrate
      // private/cloud-internal data through the user's browser.
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return err(`Only http:// and https:// URLs are allowed. Got: ${parsed.protocol}`);
        }
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        // Loopback (entire 127.0.0.0/8 range, IPv6 ::1, "localhost")
        if (host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)) {
          return err("Opening localhost URLs is not allowed.");
        }
        // RFC1918 private networks
        if (host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
          return err("Opening internal network URLs is not allowed.");
        }
        // Link-local: 169.254.0.0/16 — includes cloud metadata endpoints
        // (169.254.169.254 on AWS/GCP/Azure) and IPv6 fe80::/10
        if (host.startsWith("169.254.") || host.startsWith("fe80:") || host.startsWith("fe80::")) {
          return err("Opening link-local / cloud metadata URLs is not allowed.");
        }
        // IPv6 unique local addresses fc00::/7 (fc00:: – fdff::)
        if (/^f[cd][0-9a-f]{2}:/.test(host)) {
          return err("Opening IPv6 unique-local URLs is not allowed.");
        }
        // Unspecified address / mDNS
        if (host === "0.0.0.0" || host === "::" || host.endsWith(".local")) {
          return err("Opening unspecified or mDNS URLs is not allowed.");
        }
      } catch {
        return err("Invalid URL format.");
      }
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
      description:
        "Execute JavaScript in a Safari tab. Use list_tabs to find window/tab indices. Returns the result as a string.",
      inputSchema: {
        code: z.string().max(100000).describe("JavaScript to execute"),
        windowIndex: z.number().int().min(0).optional().default(0).describe("Window index (default: 0)"),
        tabIndex: z.number().int().min(0).optional().default(0).describe("Tab index (default: 0)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ code, windowIndex, tabIndex }) => {
      if (!allowRunJavascript)
        return err(
          "Running JavaScript in Safari is disabled. Set AIRMCP_ALLOW_RUN_JAVASCRIPT=true or allowRunJavascript in config.json.",
        );
      try {
        return okUntrusted(await runJxa(runJavascriptScript(code, windowIndex, tabIndex)));
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
        query: z.string().max(500).describe("Search keyword to match against tab titles and URLs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        return okUntrusted(await runJxa(searchTabsScript(query)));
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
      outputSchema: {
        count: z.number(),
        bookmarks: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            folder: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrustedStructured(await runJxa(listBookmarksScript()));
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
        title: z.string().max(500).describe("Bookmark title"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      return err(
        "add_bookmark is deprecated — Safari removed bookmark scripting in macOS 26. " +
          "Use add_to_reading_list instead.",
      );
    },
  );

  server.registerTool(
    "list_reading_list",
    {
      title: "List Reading List",
      description: "List all items in Safari's Reading List.",
      inputSchema: {},
      outputSchema: {
        count: z.number(),
        items: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrustedStructured(await runJxa(listReadingListScript()));
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
        title: z.string().max(500).optional().describe("Title for the Reading List item"),
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
