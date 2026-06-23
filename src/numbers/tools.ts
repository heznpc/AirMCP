import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrustedStructured, errJxaFor } from "../shared/result.js";
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
} from "./scripts.js";

export function registerNumbersTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "numbers_list_documents",
    {
      title: "List Numbers Documents",
      description: "List all open Numbers spreadsheets.",
      inputSchema: {},
      outputSchema: {
        documents: z.array(
          z.object({
            name: z.string(),
            path: z.string().nullable(),
            modified: z.boolean(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const documents = (await runJxa(listDocumentsScript())) as Array<unknown>;
        return okUntrustedStructured({ documents });
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        sensitiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
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
      outputSchema: {
        sheets: z.array(
          z.object({
            name: z.string(),
            tableCount: z.number().int().min(0),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        const sheets = (await runJxa(listSheetsScript(document))) as Array<unknown>;
        return okUntrustedStructured({ sheets });
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
      outputSchema: {
        address: z.string(),
        // Cell values are dynamically typed in Numbers (number, string, date, boolean, null).
        // Zod's `unknown()` keeps the contract honest rather than forcing a coercion.
        value: z.unknown(),
        formattedValue: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, cell }) => {
      try {
        return okUntrustedStructured(await runJxa(getCellScript(document, sheet, cell)));
      } catch (e) {
        return errJxaFor("get Numbers cell", e);
      }
    },
  );

  server.registerTool(
    "numbers_set_cell",
    {
      title: "Set Numbers Cell",
      description:
        "Write a value to a single cell. Numbers and booleans land as native cell types (not " +
        "text), so they sort and feed formulas correctly; strings are written verbatim and " +
        "Numbers interprets a leading '=' as a formula.",
      inputSchema: {
        document: z.string().max(500).describe("Document name"),
        sheet: z.string().max(500).describe("Sheet name"),
        cell: z.string().max(500).describe("Cell address (e.g. 'A1')"),
        value: z
          .union([z.string().max(10000), z.number().finite(), z.boolean()])
          .describe("Value to write (number, boolean, or text)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        sensitiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      outputSchema: {
        // Outer array = rows. Inner array = cell values per row.
        // Cell values stay `unknown` for the same dynamic-typing reason as get_cell.
        rows: z.array(z.array(z.unknown())),
        startRow: z.number().int().min(0),
        startCol: z.number().int().min(0),
        endRow: z.number().int().min(0),
        endCol: z.number().int().min(0),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, startRow, startCol, endRow, endCol }) => {
      try {
        return okUntrustedStructured(
          await runJxa(readCellsScript(document, sheet, startRow, startCol, endRow, endCol)),
        );
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        sensitiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
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
      outputSchema: {
        tables: z.array(
          z.object({
            name: z.string(),
            rowCount: z.number().int().min(0),
            columnCount: z.number().int().min(0),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet }) => {
      try {
        const tables = (await runJxa(listTablesScript(document, sheet))) as Array<unknown>;
        return okUntrustedStructured({ tables });
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
      outputSchema: {
        address: z.string(),
        // `formula` is null when the cell holds a constant (no formula behind it).
        formula: z.string().nullable(),
        value: z.unknown(),
        formattedValue: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document, sheet, cell }) => {
      try {
        return okUntrustedStructured(await runJxa(getFormulaScript(document, sheet, cell)));
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        sensitiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ document, sheet, newName }) => {
      try {
        return ok(await runJxa(renameSheetScript(document, sheet, newName)));
      } catch (e) {
        return errJxaFor("rename Numbers sheet", e);
      }
    },
  );
}
