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
  listChartsScript,
  setFormulaScript,
  setRangeScript,
  resizeTableScript,
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

  // RFC 0009 Phase 1 batch 2 — list_charts (read) + set_formula / set_range / resize_table (edit).

  server.registerTool(
    "numbers_list_charts",
    {
      title: "List Numbers Charts",
      description:
        "List every chart in a Numbers sheet with its name + chart type. " +
        "A sheet can carry multiple charts (revenue trend + segment pie + region bar); " +
        "a model picking which one to interrogate or update needs to enumerate them first. " +
        "Symmetric to numbers_list_tables.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet }) => {
      try {
        return ok(await runJxa(listChartsScript(document, sheet)));
      } catch (e) {
        return errJxaFor("list Numbers charts", e);
      }
    },
  );

  server.registerTool(
    "numbers_set_formula",
    {
      title: "Set Numbers Cell Formula",
      description:
        "Write a formula expression to a cell (e.g. '=SUM(A1:A10)'). " +
        "The leading '=' is optional — passing 'SUM(A1:A10)' or '=SUM(A1:A10)' both work. " +
        "Errors in the formula (bad reference, unknown function) surface as errJxa with the Numbers parse message. " +
        "Symmetric to numbers_get_formula.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        cell: z.string().max(500).describe("Cell address (e.g. 'A1')"),
        formula: z.string().min(1).max(10000).describe("Formula expression — '=' prefix optional"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, cell, formula }) => {
      try {
        return ok(await runJxa(setFormulaScript(document, sheet, cell, formula)));
      } catch (e) {
        return errJxaFor("set Numbers formula", e);
      }
    },
  );

  server.registerTool(
    "numbers_set_range",
    {
      title: "Set Numbers Cell Range",
      description:
        "Bulk-write a 2D rectangular block of string values starting at a top-left cell address (e.g. 'B2'). " +
        "Each value is written via the .value setter — values starting with '=' are parsed as formulas (same as numbers_set_cell). " +
        "Cell addresses use A1 notation; the script auto-extends past Z (AA, AB, …). " +
        "Returns the count of cells written. Capped at 1000 cells per call to stay within Phase 1's range-size budget (RFC 0009 §6.2).",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        startCell: z
          .string()
          .regex(/^[A-Z]+[0-9]+$/)
          .max(20)
          .describe("Top-left cell address in A1 notation (e.g. 'B2')"),
        values: z
          .array(z.array(z.string().max(10000)))
          .min(1)
          .max(1000)
          .describe("2D array: outer = rows, inner = columns. Max 1000 cells total."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, startCell, values }) => {
      try {
        const total = values.reduce((sum: number, row: string[]) => sum + row.length, 0);
        if (total > 1000) {
          throw new Error(`Range size ${total} exceeds Phase 1 cap of 1000 cells (RFC 0009 §6.2)`);
        }
        return ok(await runJxa(setRangeScript(document, sheet, startCell, values)));
      } catch (e) {
        return errJxaFor("set Numbers range", e);
      }
    },
  );

  server.registerTool(
    "numbers_resize_table",
    {
      title: "Resize Numbers Table",
      description:
        "Resize a table by setting its rowCount and/or columnCount. " +
        "Growing appends empty rows/columns on the bottom/right. " +
        "Shrinking DISCARDS the trailing rows/columns AND THEIR CONTENT — destructive. " +
        "Pass null for either dimension to leave it unchanged.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        rowCount: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .nullable()
          .describe("New row count (null to leave unchanged). Shrinking truncates trailing rows."),
        columnCount: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .nullable()
          .describe("New column count (null to leave unchanged). Shrinking truncates trailing columns."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, rowCount, columnCount }) => {
      try {
        if (rowCount === null && columnCount === null) {
          throw new Error("At least one of rowCount or columnCount must be provided");
        }
        return ok(await runJxa(resizeTableScript(document, sheet, rowCount, columnCount)));
      } catch (e) {
        return errJxaFor("resize Numbers table", e);
      }
    },
  );
}
