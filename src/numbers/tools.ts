import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, errJxaFor } from "../shared/result.js";
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
  listTablesScript,
  getFormulaScript,
  renameSheetScript,
  insertRowScript,
  insertColumnScript,
  deleteRowScript,
  deleteColumnScript,
  duplicateSheetScript,
  createTableScript,
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
        return errJxaFor("list Numbers documents", e);
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
        return errJxaFor("create Numbers document", e);
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
        return errJxaFor("list Numbers sheets", e);
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
        return errJxaFor("get Numbers cell", e);
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
        return errJxaFor("set Numbers cell", e);
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
        return errJxaFor("read Numbers cells", e);
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
        return errJxaFor("add Numbers sheet", e);
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
        return errJxaFor("export Numbers to PDF", e);
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
        return errJxaFor("close Numbers document", e);
      }
    },
  );

  // RFC 0009 Phase 1 — first batch of structured-edit tools.

  server.registerTool(
    "numbers_list_tables",
    {
      title: "List Numbers Tables",
      description:
        "List every table in a Numbers sheet with its name + dimensions. " +
        "A sheet can hold multiple tables (totals + breakdown + chart-source); " +
        "the older tools assume the first table is canonical, this lets a caller pick by name.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet }) => {
      try {
        return ok(await runJxa(listTablesScript(document, sheet)));
      } catch (e) {
        return errJxaFor("list Numbers tables", e);
      }
    },
  );

  server.registerTool(
    "numbers_get_formula",
    {
      title: "Get Numbers Cell Formula",
      description:
        "Read the literal formula behind a cell (e.g. '=SUM(A1:A10)') instead of its evaluated value. " +
        "Returns null formula for cells that hold a constant.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        cell: z.string().max(500).describe("Cell address (e.g. 'A1')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, cell }) => {
      try {
        return ok(await runJxa(getFormulaScript(document, sheet, cell)));
      } catch (e) {
        return errJxaFor("get Numbers formula", e);
      }
    },
  );

  server.registerTool(
    "numbers_rename_sheet",
    {
      title: "Rename Numbers Sheet",
      description:
        "Rename a sheet in place. Numbers does NOT allow duplicate sheet names; the call fails with errJxa when the new name is taken.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Current sheet name"),
        newName: z.string().min(1).max(500).describe("New sheet name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, newName }) => {
      try {
        return ok(await runJxa(renameSheetScript(document, sheet, newName)));
      } catch (e) {
        return errJxaFor("rename Numbers sheet", e);
      }
    },
  );

  // RFC 0009 Phase 1 batch 3 — structural row/column edits + sheet/table creation.

  server.registerTool(
    "numbers_insert_row",
    {
      title: "Insert Numbers Row",
      description:
        "Insert an empty row before the row at the given index (0-based). " +
        "If atIndex >= rowCount, the row is appended at the end. " +
        "Non-destructive — existing content shifts down.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        atIndex: z.number().int().min(0).describe("0-based row index to insert before"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, atIndex }) => {
      try {
        return ok(await runJxa(insertRowScript(document, sheet, atIndex)));
      } catch (e) {
        return errJxaFor("insert Numbers row", e);
      }
    },
  );

  server.registerTool(
    "numbers_insert_column",
    {
      title: "Insert Numbers Column",
      description:
        "Insert an empty column before the column at the given index (0-based). " +
        "If atIndex >= columnCount, the column is appended at the right edge. " +
        "Non-destructive — existing content shifts right.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        atIndex: z.number().int().min(0).describe("0-based column index to insert before"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, atIndex }) => {
      try {
        return ok(await runJxa(insertColumnScript(document, sheet, atIndex)));
      } catch (e) {
        return errJxaFor("insert Numbers column", e);
      }
    },
  );

  server.registerTool(
    "numbers_delete_row",
    {
      title: "Delete Numbers Row",
      description:
        "Delete the row at the given index (0-based). " +
        "DESTRUCTIVE — the row AND its cell content are removed; rows below shift up. " +
        "Throws if atIndex is out of bounds.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        atIndex: z.number().int().min(0).describe("0-based row index to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, atIndex }) => {
      try {
        return ok(await runJxa(deleteRowScript(document, sheet, atIndex)));
      } catch (e) {
        return errJxaFor("delete Numbers row", e);
      }
    },
  );

  server.registerTool(
    "numbers_delete_column",
    {
      title: "Delete Numbers Column",
      description:
        "Delete the column at the given index (0-based). " +
        "DESTRUCTIVE — the column AND its cell content are removed; columns to the right shift left. " +
        "Throws if atIndex is out of bounds.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        atIndex: z.number().int().min(0).describe("0-based column index to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, atIndex }) => {
      try {
        return ok(await runJxa(deleteColumnScript(document, sheet, atIndex)));
      } catch (e) {
        return errJxaFor("delete Numbers column", e);
      }
    },
  );

  server.registerTool(
    "numbers_duplicate_sheet",
    {
      title: "Duplicate Numbers Sheet",
      description:
        "Duplicate a sheet with all its tables and content. " +
        "If newName is provided, the copy is renamed; otherwise Numbers auto-suffixes (e.g. 'Sheet 1 - Copy'). " +
        "Throws if newName already exists (Numbers does not allow duplicate sheet names).",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Source sheet name"),
        newName: z.string().max(500).nullable().describe("Optional new name. Pass null to let Numbers auto-suffix."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, newName }) => {
      try {
        return ok(await runJxa(duplicateSheetScript(document, sheet, newName)));
      } catch (e) {
        return errJxaFor("duplicate Numbers sheet", e);
      }
    },
  );

  server.registerTool(
    "numbers_create_table",
    {
      title: "Create Numbers Table",
      description:
        "Create a new table on a sheet with the given dimensions. " +
        "If name is provided, the table is named accordingly; otherwise Numbers auto-names (e.g. 'Table 2'). " +
        "Throws if name collides with an existing table on the same sheet.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Target sheet name"),
        rowCount: z.number().int().min(1).max(100000).describe("Number of rows in the new table"),
        columnCount: z.number().int().min(1).max(1000).describe("Number of columns in the new table"),
        name: z.string().max(500).nullable().describe("Optional table name. Pass null for auto-naming."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ document, sheet, rowCount, columnCount, name }) => {
      try {
        return ok(await runJxa(createTableScript(document, sheet, rowCount, columnCount, name)));
      } catch (e) {
        return errJxaFor("create Numbers table", e);
      }
    },
  );
}
