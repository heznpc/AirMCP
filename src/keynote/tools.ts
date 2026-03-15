import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import { zFilePath } from "../shared/validate.js";
import {
  listDocumentsScript,
  createDocumentScript,
  listSlidesScript,
  getSlideScript,
  addSlideScript,
  setPresenterNotesScript,
  exportPdfScript,
  startSlideshowScript,
  closeDocumentScript,
} from "./scripts.js";

export function registerKeynoteTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "keynote_list_documents",
    {
      title: "List Keynote Documents",
      description: "List all open Keynote presentations.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listDocumentsScript()));
      } catch (e) {
        return toolError("list Keynote documents", e);
      }
    },
  );

  server.registerTool(
    "keynote_create_document",
    {
      title: "Create Keynote Presentation",
      description: "Create a new blank Keynote presentation.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(createDocumentScript()));
      } catch (e) {
        return toolError("create Keynote presentation", e);
      }
    },
  );

  server.registerTool(
    "keynote_list_slides",
    {
      title: "List Keynote Slides",
      description: "List all slides in a Keynote presentation with title, body preview, and presenter notes.",
      inputSchema: {
        document: z.string().describe("Document name"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        return ok(await runJxa(listSlidesScript(document)));
      } catch (e) {
        return toolError("list Keynote slides", e);
      }
    },
  );

  server.registerTool(
    "keynote_get_slide",
    {
      title: "Get Keynote Slide",
      description: "Get detailed content of a specific slide including all text items and presenter notes.",
      inputSchema: {
        document: z.string().describe("Document name"),
        slideNumber: z.number().int().min(1).describe("Slide number (1-based)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, slideNumber }) => {
      try {
        return ok(await runJxa(getSlideScript(document, slideNumber)));
      } catch (e) {
        return toolError("get Keynote slide", e);
      }
    },
  );

  server.registerTool(
    "keynote_add_slide",
    {
      title: "Add Keynote Slide",
      description: "Add a new slide to a Keynote presentation.",
      inputSchema: {
        document: z.string().describe("Document name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        return ok(await runJxa(addSlideScript(document)));
      } catch (e) {
        return toolError("add Keynote slide", e);
      }
    },
  );

  server.registerTool(
    "keynote_set_presenter_notes",
    {
      title: "Set Keynote Presenter Notes",
      description: "Set presenter notes on a specific slide.",
      inputSchema: {
        document: z.string().describe("Document name"),
        slideNumber: z.number().int().min(1).describe("Slide number (1-based)"),
        notes: z.string().describe("Presenter notes text"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, slideNumber, notes }) => {
      try {
        return ok(await runJxa(setPresenterNotesScript(document, slideNumber, notes)));
      } catch (e) {
        return toolError("set Keynote presenter notes", e);
      }
    },
  );

  server.registerTool(
    "keynote_export_pdf",
    {
      title: "Export Keynote to PDF",
      description: "Export a Keynote presentation to PDF.",
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
        return toolError("export Keynote to PDF", e);
      }
    },
  );

  server.registerTool(
    "keynote_start_slideshow",
    {
      title: "Start Keynote Slideshow",
      description: "Start playing a Keynote slideshow from a specific slide.",
      inputSchema: {
        document: z.string().describe("Document name"),
        fromSlide: z.number().int().min(1).optional().default(1).describe("Start from slide number (default: 1)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, fromSlide }) => {
      try {
        return ok(await runJxa(startSlideshowScript(document, fromSlide)));
      } catch (e) {
        return toolError("start Keynote slideshow", e);
      }
    },
  );

  server.registerTool(
    "keynote_close_document",
    {
      title: "Close Keynote Document",
      description: "Close an open Keynote presentation, optionally saving changes.",
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
        return toolError("close Keynote document", e);
      }
    },
  );
}
