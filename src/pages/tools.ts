import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errJxaFor } from "../shared/result.js";
import { zFilePath, resolveAndGuard } from "../shared/validate.js";
import {
  listDocumentsScript,
  openDocumentScript,
  createDocumentScript,
  getBodyTextScript,
  setBodyTextScript,
  exportPdfScript,
  closeDocumentScript,
} from "./scripts.js";

// Shared shape for the open-document descriptor returned by JXA. Pages
// reports `path` as null when the document hasn't been saved to disk yet
// (untitled new documents), so the schema is explicit about nullability.
const pagesDocSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  modified: z.boolean(),
});

export function registerPagesTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "pages_list_documents",
    {
      title: "List Pages Documents",
      description: "List all open Pages documents with name, path, and modified status.",
      inputSchema: {},
      // Wave 8 outputSchema: documents come from open Pages files whose
      // titles are user-controlled, so we mark the field as untrusted in
      // the helper. The shape itself is fixed by the JXA script.
      outputSchema: {
        documents: z.array(pagesDocSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const documents = (await runJxa(listDocumentsScript())) as Array<unknown>;
        return okUntrustedStructured({ documents });
      } catch (e) {
        return errJxaFor("list Pages documents", e);
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
      // `modified` is omitted from the script output here (open just
      // reports name + path) — schema follows the actual shape rather
      // than padding with synthetic fields.
      outputSchema: {
        name: z.string(),
        path: z.string().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        const result = (await runJxa(openDocumentScript(path))) as { name: string; path: string | null };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("open Pages document", e);
      }
    },
  );

  server.registerTool(
    "pages_create_document",
    {
      title: "Create Pages Document",
      description: "Create a new blank Pages document.",
      inputSchema: {},
      outputSchema: {
        name: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const result = (await runJxa(createDocumentScript())) as { name: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("create Pages document", e);
      }
    },
  );

  server.registerTool(
    "pages_get_body_text",
    {
      title: "Get Pages Body Text",
      description: "Get the body text content of an open Pages document.",
      inputSchema: {
        document: z.string().max(500).describe("Document name (as shown in title bar)"),
      },
      // bodyText is truncated to 10,000 chars by the script — schema
      // documents the bound so callers don't expect the full document.
      outputSchema: {
        name: z.string(),
        bodyText: z.string().max(10000),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        const result = (await runJxa(getBodyTextScript(document))) as { name: string; bodyText: string };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("get Pages body text", e);
      }
    },
  );

  server.registerTool(
    "pages_set_body_text",
    {
      title: "Set Pages Body Text",
      description: "Replace the body text of an open Pages document.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        text: z.string().max(50000).describe("New body text content"),
      },
      outputSchema: {
        updated: z.literal(true),
        name: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, text }) => {
      try {
        const result = (await runJxa(setBodyTextScript(document, text))) as { updated: true; name: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("set Pages body text", e);
      }
    },
  );

  server.registerTool(
    "pages_export_pdf",
    {
      title: "Export Pages to PDF",
      description: "Export an open Pages document to PDF. Will overwrite an existing file at the same path.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        outputPath: zFilePath.describe("Absolute output path for the PDF file"),
      },
      outputSchema: {
        exported: z.literal(true),
        path: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ document, outputPath }) => {
      try {
        resolveAndGuard(outputPath);
        const result = (await runJxa(exportPdfScript(document, outputPath))) as { exported: true; path: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("export Pages to PDF", e);
      }
    },
  );

  server.registerTool(
    "pages_close_document",
    {
      title: "Close Pages Document",
      description: "Close an open Pages document, optionally saving changes.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        saving: z.boolean().optional().default(true).describe("Save before closing (default: true)"),
      },
      outputSchema: {
        closed: z.literal(true),
        name: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, saving }) => {
      try {
        const result = (await runJxa(closeDocumentScript(document, saving))) as { closed: true; name: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("close Pages document", e);
      }
    },
  );
}
