import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import { zFilePath } from "../shared/validate.js";
import {
  listDocumentsScript,
  openDocumentScript,
  createDocumentScript,
  getBodyTextScript,
  setBodyTextScript,
  exportPdfScript,
  closeDocumentScript,
} from "./scripts.js";

export function registerPagesTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "pages_list_documents",
    {
      title: "List Pages Documents",
      description: "List all open Pages documents with name, path, and modified status.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listDocumentsScript()));
      } catch (e) {
        return toolError("list Pages documents", e);
      }
    },
  );

  server.registerTool(
    "pages_open_document",
    {
      title: "Open Pages Document",
      description: "Open a Pages document from a file path.",
      inputSchema: {
        path: zFilePath.describe("Absolute file path to the .pages document"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        return ok(await runJxa(openDocumentScript(path)));
      } catch (e) {
        return toolError("open Pages document", e);
      }
    },
  );

  server.registerTool(
    "pages_create_document",
    {
      title: "Create Pages Document",
      description: "Create a new blank Pages document.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(createDocumentScript()));
      } catch (e) {
        return toolError("create Pages document", e);
      }
    },
  );

  server.registerTool(
    "pages_get_body_text",
    {
      title: "Get Pages Body Text",
      description: "Get the body text content of an open Pages document.",
      inputSchema: {
        document: z.string().describe("Document name (as shown in title bar)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        return ok(await runJxa(getBodyTextScript(document)));
      } catch (e) {
        return toolError("get Pages body text", e);
      }
    },
  );

  server.registerTool(
    "pages_set_body_text",
    {
      title: "Set Pages Body Text",
      description: "Replace the body text of an open Pages document.",
      inputSchema: {
        document: z.string().describe("Document name"),
        text: z.string().describe("New body text content"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, text }) => {
      try {
        return ok(await runJxa(setBodyTextScript(document, text)));
      } catch (e) {
        return toolError("set Pages body text", e);
      }
    },
  );

  server.registerTool(
    "pages_export_pdf",
    {
      title: "Export Pages to PDF",
      description: "Export an open Pages document to PDF.",
      inputSchema: {
        document: z.string().describe("Document name"),
        outputPath: zFilePath.describe("Absolute output path for the PDF file"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ document, outputPath }) => {
      try {
        return ok(await runJxa(exportPdfScript(document, outputPath)));
      } catch (e) {
        return toolError("export Pages to PDF", e);
      }
    },
  );

  server.registerTool(
    "pages_close_document",
    {
      title: "Close Pages Document",
      description: "Close an open Pages document, optionally saving changes.",
      inputSchema: {
        document: z.string().describe("Document name"),
        saving: z.boolean().optional().default(true).describe("Save before closing (default: true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, saving }) => {
      try {
        return ok(await runJxa(closeDocumentScript(document, saving)));
      } catch (e) {
        return toolError("close Pages document", e);
      }
    },
  );
}
