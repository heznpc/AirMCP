import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errJxaFor } from "../shared/result.js";
import { zFilePath, resolveAndGuard } from "../shared/validate.js";
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

// Shared shape for the open-document descriptor returned by JXA. Keynote
// reports `path` as null when the document hasn't been saved to disk yet
// (untitled new documents), so the schema is explicit about nullability.
const keynoteDocSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  modified: z.boolean(),
});

// Per-slide summary returned by listSlidesScript. Title and body fall back
// to null when the slide layout has no default title/body item.
const keynoteSlideSummarySchema = z.object({
  number: z.number().int(),
  skipped: z.boolean(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  presenterNotes: z.string(),
});

export function registerKeynoteTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "keynote_list_documents",
    {
      title: "List Keynote Documents",
      description: "List all open Keynote presentations.",
      inputSchema: {},
      // Wave 8 outputSchema: documents come from open Keynote files whose
      // titles are user-controlled, so we mark the field as untrusted in
      // the helper. The shape itself is fixed by the JXA script.
      outputSchema: {
        documents: z.array(keynoteDocSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const documents = (await runJxa(listDocumentsScript())) as Array<unknown>;
        return okUntrustedStructured({ documents });
      } catch (e) {
        return errJxaFor("list Keynote documents", e);
      }
    },
  );

  server.registerTool(
    "keynote_create_document",
    {
      title: "Create Keynote Presentation",
      description: "Create a new blank Keynote presentation.",
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
        return errJxaFor("create Keynote presentation", e);
      }
    },
  );

  server.registerTool(
    "keynote_list_slides",
    {
      title: "List Keynote Slides",
      description: "List all slides in a Keynote presentation with title, body preview, and presenter notes.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
      },
      // Slide content (title/body/notes) is user-controlled text from the
      // presentation, so we mark the structured payload as untrusted.
      outputSchema: {
        total: z.number().int(),
        slides: z.array(keynoteSlideSummarySchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        const result = (await runJxa(listSlidesScript(document))) as {
          total: number;
          slides: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("list Keynote slides", e);
      }
    },
  );

  server.registerTool(
    "keynote_get_slide",
    {
      title: "Get Keynote Slide",
      description: "Get detailed content of a specific slide including all text items and presenter notes.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        slideNumber: z.number().int().min(1).describe("Slide number (1-based)"),
      },
      // textItems and presenterNotes are user-authored content.
      outputSchema: {
        number: z.number().int(),
        skipped: z.boolean(),
        presenterNotes: z.string(),
        textItems: z.array(z.object({ objectText: z.string() })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, slideNumber }) => {
      try {
        const result = (await runJxa(getSlideScript(document, slideNumber))) as {
          number: number;
          skipped: boolean;
          presenterNotes: string;
          textItems: Array<{ objectText: string }>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("get Keynote slide", e);
      }
    },
  );

  server.registerTool(
    "keynote_add_slide",
    {
      title: "Add Keynote Slide",
      description: "Add a new slide to a Keynote presentation.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
      },
      outputSchema: {
        added: z.literal(true),
        slideNumber: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        const result = (await runJxa(addSlideScript(document))) as { added: true; slideNumber: number };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("add Keynote slide", e);
      }
    },
  );

  server.registerTool(
    "keynote_set_presenter_notes",
    {
      title: "Set Keynote Presenter Notes",
      description: "Set presenter notes on a specific slide.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        slideNumber: z.number().int().min(1).describe("Slide number (1-based)"),
        notes: z.string().max(5000).describe("Presenter notes text"),
      },
      outputSchema: {
        updated: z.literal(true),
        slideNumber: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, slideNumber, notes }) => {
      try {
        const result = (await runJxa(setPresenterNotesScript(document, slideNumber, notes))) as {
          updated: true;
          slideNumber: number;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("set Keynote presenter notes", e);
      }
    },
  );

  server.registerTool(
    "keynote_export_pdf",
    {
      title: "Export Keynote to PDF",
      description: "Export a Keynote presentation to PDF. Will overwrite an existing file at the same path.",
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
        return errJxaFor("export Keynote to PDF", e);
      }
    },
  );

  server.registerTool(
    "keynote_start_slideshow",
    {
      title: "Start Keynote Slideshow",
      description: "Start playing a Keynote slideshow from a specific slide.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        fromSlide: z.number().int().min(1).optional().default(1).describe("Start from slide number (default: 1)"),
      },
      outputSchema: {
        started: z.literal(true),
        fromSlide: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, fromSlide }) => {
      try {
        const result = (await runJxa(startSlideshowScript(document, fromSlide))) as {
          started: true;
          fromSlide: number;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("start Keynote slideshow", e);
      }
    },
  );

  server.registerTool(
    "keynote_close_document",
    {
      title: "Close Keynote Document",
      description: "Close an open Keynote presentation, optionally saving changes.",
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
        return errJxaFor("close Keynote document", e);
      }
    },
  );
}
