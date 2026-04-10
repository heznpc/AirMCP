import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import { zFilePath, resolveAndGuard } from "../shared/validate.js";
import {
  listDocumentsScript,
  createDocumentScript,
  listSheetsScript,
  getCellScript,
  setCellScript,
  readCellsScript,
  addSheetScript,
  exportPdfScript,
  closeDocumentScript,
} from "./scripts.js";

export function registerNumbersTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "numbers_list_documents",
    {
      title: "List Numbers Documents",
      description: "List all open Numbers spreadsheets.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listDocumentsScript()));
      } catch (e) {
        return toolError("list Numbers documents", e);
      }
    },
  );

  server.registerTool(
    "numbers_create_document",
    {
      title: "Create Numbers Document",
      description: "Create a new blank Numbers spreadsheet.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(createDocumentScript()));
      } catch (e) {
        return toolError("create Numbers document", e);
      }
    },
  );

  server.registerTool(
    "numbers_list_sheets",
    {
      title: "List Numbers Sheets",
      description: "List all sheets (tabs) in a Numbers spreadsheet.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        return ok(await runJxa(listSheetsScript(document)));
      } catch (e) {
        return toolError("list Numbers sheets", e);
      }
    },
  );

  server.registerTool(
    "numbers_get_cell",
    {
      title: "Get Numbers Cell",
      description: "Read a single cell value by address (e.g. 'A1').",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        cell: z.string().max(500).describe("Cell address (e.g. 'A1', 'B3')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, cell }) => {
      try {
        return ok(await runJxa(getCellScript(document, sheet, cell)));
      } catch (e) {
        return toolError("get Numbers cell", e);
      }
    },
  );

  server.registerTool(
    "numbers_set_cell",
    {
      title: "Set Numbers Cell",
      description: "Write a value to a single cell.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        cell: z.string().max(500).describe("Cell address (e.g. 'A1')"),
        value: z.string().max(10000).describe("Value to write"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, cell, value }) => {
      try {
        return ok(await runJxa(setCellScript(document, sheet, cell, value)));
      } catch (e) {
        return toolError("set Numbers cell", e);
      }
    },
  );

  server.registerTool(
    "numbers_read_cells",
    {
      title: "Read Numbers Cell Range",
      description: "Read a range of cells from a sheet. Uses 0-based row/column indices.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        startRow: z.number().int().min(0).describe("Start row index (0-based)"),
        startCol: z.number().int().min(0).describe("Start column index (0-based)"),
        endRow: z.number().int().min(0).describe("End row index (inclusive)"),
        endCol: z.number().int().min(0).describe("End column index (inclusive)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, startRow, startCol, endRow, endCol }) => {
      try {
        return ok(await runJxa(readCellsScript(document, sheet, startRow, startCol, endRow, endCol)));
      } catch (e) {
        return toolError("read Numbers cells", e);
      }
    },
  );

  server.registerTool(
    "numbers_add_sheet",
    {
      title: "Add Numbers Sheet",
      description: "Add a new sheet to a Numbers spreadsheet.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheetName: z.string().max(500).describe("Name for the new sheet"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheetName }) => {
      try {
        return ok(await runJxa(addSheetScript(document, sheetName)));
      } catch (e) {
        return toolError("add Numbers sheet", e);
      }
    },
  );

  server.registerTool(
    "numbers_export_pdf",
    {
      title: "Export Numbers to PDF",
      description: "Export a Numbers spreadsheet to PDF. Will overwrite an existing file at the same path.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        outputPath: zFilePath.describe("Absolute output path for the PDF file"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ document, outputPath }) => {
      try {
        resolveAndGuard(outputPath);
        return ok(await runJxa(exportPdfScript(document, outputPath)));
      } catch (e) {
        return toolError("export Numbers to PDF", e);
      }
    },
  );

  server.registerTool(
    "numbers_close_document",
    {
      title: "Close Numbers Document",
      description: "Close an open Numbers spreadsheet, optionally saving changes.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        saving: z.boolean().optional().default(true).describe("Save before closing (default: true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, saving }) => {
      try {
        return ok(await runJxa(closeDocumentScript(document, saving)));
      } catch (e) {
        return toolError("close Numbers document", e);
      }
    },
  );
}
