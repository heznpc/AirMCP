/**
 * Google Workspace module — wraps @googleworkspace/cli (gws) for
 * Gmail, Drive, Sheets, Calendar, Docs, Tasks, People, and Chat.
 *
 * Requires: npm install -g @googleworkspace/cli && gws auth setup
 */
import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, err } from "../shared/result.js";
import { runGws, checkGws } from "./gws.js";

export function registerGoogleTools(server: McpServer, config: AirMcpConfig): void {
  const { allowSendMail } = config;
  // ── Status ─────────────────────────────────────────────────────────

  server.registerTool(
    "gws_status",
    {
      title: "Google Workspace Status",
      description: "Check if Google Workspace CLI (gws) is installed and authenticated.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const error = await checkGws();
      if (error) return err(error + "\nInstall: npm install -g @googleworkspace/cli && gws auth setup");
      return ok({ available: true, message: "Google Workspace CLI is ready." });
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // GMAIL
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_gmail_list",
    {
      title: "List Gmail Messages",
      description: "List recent Gmail messages. Supports query filters (e.g. 'from:alice is:unread').",
      inputSchema: {
        query: z.string().optional().describe("Gmail search query (e.g. 'is:unread', 'from:bob subject:report')"),
        maxResults: z.number().int().min(1).max(100).optional().default(20).describe("Max messages to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, maxResults }) => {
      try {
        const params: Record<string, unknown> = { userId: "me", maxResults };
        if (query) params.q = query;
        return ok(await runGws("gmail", "users.messages", "list", params));
      } catch (e) {
        return err(`Gmail list failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_gmail_read",
    {
      title: "Read Gmail Message",
      description: "Read a Gmail message by ID. Returns subject, from, to, date, and body.",
      inputSchema: {
        messageId: z.string().min(1).describe("Gmail message ID"),
        format: z.enum(["full", "metadata", "minimal"]).optional().default("full").describe("Response format"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ messageId, format }) => {
      try {
        return okUntrusted(await runGws("gmail", "users.messages", "get", { userId: "me", id: messageId, format }));
      } catch (e) {
        return err(`Gmail read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_gmail_send",
    {
      title: "Send Gmail",
      description: "Send an email via Gmail. Encodes the message in RFC 2822 format.",
      inputSchema: {
        to: z.string().min(1).describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body (plain text)"),
        cc: z.string().optional().describe("CC recipients (comma-separated)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ to, subject, body, cc }) => {
      if (!allowSendMail) return err("Sending mail is disabled. Set AIRMCP_ALLOW_SEND_MAIL=true or allowSendMail in config.json.");
      try {
        // Build RFC 2822 raw message
        let raw = `To: ${to}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n`;
        if (cc) raw += `Cc: ${cc}\n`;
        raw += `\n${body}`;
        const encoded = Buffer.from(raw).toString("base64url");
        return ok(await runGws("gmail", "users.messages", "send", { userId: "me" }, { raw: encoded }));
      } catch (e) {
        return err(`Gmail send failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // DRIVE
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_drive_list",
    {
      title: "List Drive Files",
      description: "List files in Google Drive. Supports query filters.",
      inputSchema: {
        query: z.string().optional().describe("Drive search query (e.g. \"name contains 'report'\" or \"mimeType = 'application/pdf'\")"),
        pageSize: z.number().int().min(1).max(100).optional().default(20).describe("Max files to return"),
        orderBy: z.string().optional().describe("Sort order (e.g. 'modifiedTime desc', 'name')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, pageSize, orderBy }) => {
      try {
        const params: Record<string, unknown> = {
          pageSize,
          fields: "files(id,name,mimeType,modifiedTime,size,webViewLink),nextPageToken",
        };
        if (query) params.q = query;
        if (orderBy) params.orderBy = orderBy;
        return ok(await runGws("drive", "files", "list", params));
      } catch (e) {
        return err(`Drive list failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_drive_read",
    {
      title: "Read Drive File Metadata",
      description: "Get metadata for a Google Drive file by ID.",
      inputSchema: {
        fileId: z.string().min(1).describe("Drive file ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ fileId }) => {
      try {
        return ok(await runGws("drive", "files", "get", {
          fileId,
          fields: "id,name,mimeType,modifiedTime,size,webViewLink,owners,shared,description",
        }));
      } catch (e) {
        return err(`Drive read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_drive_search",
    {
      title: "Search Drive",
      description: "Full-text search across Google Drive files by content or name.",
      inputSchema: {
        query: z.string().min(1).describe("Search text (searches file names and content)"),
        maxResults: z.number().int().min(1).max(50).optional().default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, maxResults }) => {
      try {
        return ok(await runGws("drive", "files", "list", {
          q: `fullText contains '${query.replace(/'/g, "\\'")}'`,
          pageSize: maxResults,
          fields: "files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken",
        }));
      } catch (e) {
        return err(`Drive search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // SHEETS
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_sheets_read",
    {
      title: "Read Google Sheet",
      description: "Read cell values from a Google Sheets spreadsheet.",
      inputSchema: {
        spreadsheetId: z.string().min(1).describe("Spreadsheet ID (from URL)"),
        range: z.string().optional().default("Sheet1").describe("A1 range notation (e.g. 'Sheet1!A1:D10')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ spreadsheetId, range }) => {
      try {
        return okUntrusted(await runGws("sheets", "spreadsheets.values", "get", { spreadsheetId, range }));
      } catch (e) {
        return err(`Sheets read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_sheets_write",
    {
      title: "Write to Google Sheet",
      description: "Write values to a Google Sheets range.",
      inputSchema: {
        spreadsheetId: z.string().min(1).describe("Spreadsheet ID"),
        range: z.string().min(1).describe("A1 range (e.g. 'Sheet1!A1:B2')"),
        values: z.array(z.array(z.string())).min(1).describe("2D array of cell values [[row1col1, row1col2], ...]"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ spreadsheetId, range, values }) => {
      try {
        return ok(await runGws("sheets", "spreadsheets.values", "update", {
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
        }, { values }));
      } catch (e) {
        return err(`Sheets write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // GOOGLE CALENDAR
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_calendar_list",
    {
      title: "List Google Calendar Events",
      description: "List upcoming events from Google Calendar.",
      inputSchema: {
        maxResults: z.number().int().min(1).max(100).optional().default(10),
        query: z.string().optional().describe("Free-text search within events"),
        timeMin: z.string().optional().describe("Start time (ISO 8601). Defaults to now."),
        timeMax: z.string().optional().describe("End time (ISO 8601)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ maxResults, query, timeMin, timeMax }) => {
      try {
        const params: Record<string, unknown> = {
          calendarId: "primary",
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
          timeMin: timeMin || new Date().toISOString(),
        };
        if (query) params.q = query;
        if (timeMax) params.timeMax = timeMax;
        return ok(await runGws("calendar", "events", "list", params));
      } catch (e) {
        return err(`Calendar list failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_calendar_create",
    {
      title: "Create Google Calendar Event",
      description: "Create an event in Google Calendar.",
      inputSchema: {
        summary: z.string().min(1).describe("Event title"),
        start: z.string().min(1).describe("Start time (ISO 8601)"),
        end: z.string().min(1).describe("End time (ISO 8601)"),
        description: z.string().optional().describe("Event description"),
        location: z.string().optional().describe("Event location"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ summary, start, end, description, location }) => {
      try {
        const body: Record<string, unknown> = {
          summary,
          start: { dateTime: start },
          end: { dateTime: end },
        };
        if (description) body.description = description;
        if (location) body.location = location;
        return ok(await runGws("calendar", "events", "insert", { calendarId: "primary" }, body));
      } catch (e) {
        return err(`Calendar create failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // DOCS
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_docs_read",
    {
      title: "Read Google Doc",
      description: "Read the content of a Google Doc by document ID.",
      inputSchema: {
        documentId: z.string().min(1).describe("Google Docs document ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ documentId }) => {
      try {
        return okUntrusted(await runGws("docs", "documents", "get", { documentId }));
      } catch (e) {
        return err(`Docs read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // TASKS
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_tasks_list",
    {
      title: "List Google Tasks",
      description: "List tasks from Google Tasks (default task list).",
      inputSchema: {
        maxResults: z.number().int().min(1).max(100).optional().default(20),
        showCompleted: z.boolean().optional().default(false).describe("Include completed tasks"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ maxResults, showCompleted }) => {
      try {
        // Get default task list first
        const lists = await runGws<{ items?: Array<{ id: string }> }>("tasks", "tasklists", "list", { maxResults: 1 });
        const listId = lists.items?.[0]?.id || "@default";
        return ok(await runGws("tasks", "tasks", "list", { tasklist: listId, maxResults, showCompleted }));
      } catch (e) {
        return err(`Tasks list failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "gws_tasks_create",
    {
      title: "Create Google Task",
      description: "Create a task in Google Tasks.",
      inputSchema: {
        title: z.string().min(1).describe("Task title"),
        notes: z.string().optional().describe("Task notes/description"),
        due: z.string().optional().describe("Due date (ISO 8601 or YYYY-MM-DD)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ title, notes, due }) => {
      try {
        const lists = await runGws<{ items?: Array<{ id: string }> }>("tasks", "tasklists", "list", { maxResults: 1 });
        const listId = lists.items?.[0]?.id || "@default";
        const body: Record<string, unknown> = { title };
        if (notes) body.notes = notes;
        if (due) body.due = due.includes("T") ? due : `${due}T00:00:00.000Z`;
        return ok(await runGws("tasks", "tasks", "insert", { tasklist: listId }, body));
      } catch (e) {
        return err(`Tasks create failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // PEOPLE (Contacts)
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_people_search",
    {
      title: "Search Google Contacts",
      description: "Search contacts in Google People/Contacts.",
      inputSchema: {
        query: z.string().min(1).describe("Search query (name, email, phone)"),
        pageSize: z.number().int().min(1).max(30).optional().default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, pageSize }) => {
      try {
        return ok(await runGws("people", "people", "searchContacts", {
          query,
          pageSize,
          readMask: "names,emailAddresses,phoneNumbers,organizations",
        }));
      } catch (e) {
        return err(`People search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // GENERIC (any gws command)
  // ══════════════════════════════════════════════════════════════════

  server.registerTool(
    "gws_raw",
    {
      title: "Raw GWS Command",
      description: "Execute any Google Workspace CLI command. For advanced use when specific tools don't cover your need.",
      inputSchema: {
        service: z.string().min(1).describe("Service name (e.g. 'gmail', 'drive', 'sheets', 'calendar', 'docs', 'slides', 'tasks', 'chat', 'forms', 'keep')"),
        resource: z.string().min(1).describe("Resource (e.g. 'users.messages', 'files', 'spreadsheets.values')"),
        method: z.string().min(1).describe("Method (e.g. 'list', 'get', 'create', 'update', 'delete')"),
        params: z.record(z.unknown()).optional().describe("URL/query parameters as JSON"),
        body: z.record(z.unknown()).optional().describe("Request body as JSON"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ service, resource, method, params, body }) => {
      if (service === "gmail" && (method === "send" || method === "delete" || method === "trash")) {
        if (!allowSendMail) {
          return err("Gmail send/delete is disabled. Set AIRMCP_ALLOW_SEND_MAIL=true.");
        }
      }
      try {
        return ok(await runGws(service, resource, method, params, body));
      } catch (e) {
        return err(`GWS command failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
