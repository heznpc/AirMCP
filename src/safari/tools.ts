import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import { getOsVersion, type AirMcpConfig } from "../shared/config.js";
import {
  okStructured,
  okUntrustedStructured,
  okUntrustedLinkedStructured,
  errInvalidInput,
  errPermission,
  errDeprecated,
  errJxaFor,
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
        return errJxaFor("list tabs", e);
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
      outputSchema: {
        title: z.string(),
        url: z.string(),
        content: z.string(),
        truncated: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ windowIndex, tabIndex, maxLength }) => {
      try {
        return okUntrustedLinkedStructured(
          "read_page_content",
          await runJxa(readPageContentScript(windowIndex, tabIndex, maxLength)),
        );
      } catch (e) {
        return errJxaFor("read page", e);
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
        return errJxaFor("get current tab", e);
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
      outputSchema: {
        opened: z.literal(true),
        url: z.string(),
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
          return errInvalidInput(`Only http:// and https:// URLs are allowed. Got: ${parsed.protocol}`);
        }
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        // Loopback (entire 127.0.0.0/8 range, IPv6 ::1, "localhost")
        if (host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)) {
          return errInvalidInput("Opening localhost URLs is not allowed.");
        }
        // RFC1918 private networks
        if (host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
          return errInvalidInput("Opening internal network URLs is not allowed.");
        }
        // Link-local: 169.254.0.0/16 — includes cloud metadata endpoints
        // (169.254.169.254 on AWS/GCP/Azure) and IPv6 fe80::/10
        if (host.startsWith("169.254.") || host.startsWith("fe80:") || host.startsWith("fe80::")) {
          return errInvalidInput("Opening link-local / cloud metadata URLs is not allowed.");
        }
        // IPv6 unique local addresses fc00::/7 (fc00:: – fdff::)
        if (/^f[cd][0-9a-f]{2}:/.test(host)) {
          return errInvalidInput("Opening IPv6 unique-local URLs is not allowed.");
        }
        // Unspecified address / mDNS
        if (host === "0.0.0.0" || host === "::" || host.endsWith(".local")) {
          return errInvalidInput("Opening unspecified or mDNS URLs is not allowed.");
        }
      } catch {
        return errInvalidInput("Invalid URL format.");
      }
      try {
        const result = (await runJxa(openUrlScript(url))) as { opened: true; url: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("open URL", e);
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
      // `title` is the user-controlled page title of the closed tab.
      outputSchema: {
        closed: z.literal(true),
        title: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ windowIndex, tabIndex }) => {
      try {
        const result = (await runJxa(closeTabScript(windowIndex, tabIndex))) as { closed: true; title: string };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("close tab", e);
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
      // `title` / `url` come from the page itself and may be attacker-controlled.
      outputSchema: {
        activated: z.literal(true),
        title: z.string(),
        url: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ windowIndex, tabIndex }) => {
      try {
        const result = (await runJxa(activateTabScript(windowIndex, tabIndex))) as {
          activated: true;
          title: string;
          url: string;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("activate tab", e);
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
      // The script coerces the JS return value to String() — the structured
      // shape is just a `{result: string}` envelope. The string itself is
      // attacker-controlled (the JS executed in a web page), so we use the
      // untrusted helper.
      outputSchema: {
        result: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ code, windowIndex, tabIndex }) => {
      if (!allowRunJavascript)
        return errPermission(
          "Running JavaScript in Safari is disabled. Set AIRMCP_ALLOW_RUN_JAVASCRIPT=true or allowRunJavascript in config.json.",
        );
      try {
        const result = (await runJxa(runJavascriptScript(code, windowIndex, tabIndex))) as { result: string };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("run JavaScript", e);
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
      outputSchema: {
        returned: z.number(),
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
    async ({ query }) => {
      try {
        return okUntrustedLinkedStructured("search_tabs", await runJxa(searchTabsScript(query)));
      } catch (e) {
        return errJxaFor("search tabs", e);
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
        return errJxaFor("list bookmarks", e);
      }
    },
  );

  // Safari removed bookmark scripting in macOS 26 (RFC 0004 tool-level gate):
  // skip registration entirely so agents don't select a tool that cannot work.
  // Legacy hosts (macOS ≤ 25) keep the tool, but it already returns err() because
  // the underlying `make new bookmark` call is broken there too in many configs —
  // the deprecation message steers callers toward add_to_reading_list.
  const os = getOsVersion();
  if (os > 0 && os < 26) {
    server.registerTool(
      "add_bookmark",
      {
        title: "Add Bookmark (Deprecated)",
        description:
          "DEPRECATED: Safari removed bookmark scripting in macOS 26. This tool returns an error on unsupported hosts. " +
          "Use add_to_reading_list instead, which still works.",
        inputSchema: {
          url: z.string().url().describe("URL to bookmark"),
          title: z.string().max(500).describe("Bookmark title"),
        },
        // Declared for parity with the rest of the Safari surface even
        // though the handler unconditionally returns errDeprecated on
        // hosts where the tool is registered. Matches the legacy JXA
        // success shape on macOS ≤ 25.
        outputSchema: {
          added: z.literal(true),
          title: z.string(),
          url: z.string(),
          folder: z.string(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async () => {
        return errDeprecated(
          "add_bookmark is deprecated — Safari removed bookmark scripting in macOS 26. " +
            "Use add_to_reading_list instead.",
        );
      },
    );
  }

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
        return errJxaFor("list reading list", e);
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
      // `title` falls back to the URL in the script when not provided, so
      // the field is always a string.
      outputSchema: {
        added: z.literal(true),
        url: z.string(),
        title: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ url, title }) => {
      try {
        const result = (await runJxa(addToReadingListScript(url, title))) as {
          added: true;
          url: string;
          title: string;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("add to reading list", e);
      }
    },
  );
}
