import { esc } from "../shared/esc.js";
import {
  iworkDocLookup,
  iworkListDocumentsScript,
  iworkCreateDocumentScript,
  iworkExportPdfScript,
  iworkCloseDocumentScript,
} from "../shared/iwork.js";

/** Shared JXA snippet: look up a sheet and its first table within a document. */
function sheetTableLookup(sheet: string): string {
  return `const sheets = docs[0].sheets.whose({name: '${esc(sheet)}'})();
    if (sheets.length === 0) throw new Error('Sheet not found: ${esc(sheet)}');
    const table = sheets[0].tables[0];
    if (!table) throw new Error('No table found in sheet');`;
}

export function listDocumentsScript(): string {
  return iworkListDocumentsScript("Numbers");
}

export function createDocumentScript(): string {
  return iworkCreateDocumentScript("Numbers");
}

export function listSheetsScript(documentName: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheets = docs[0].sheets();
    const result = sheets.map(s => ({
      name: s.name(),
      tableCount: s.tables.length
    }));
    JSON.stringify(result);
  `;
}

export function getCellScript(documentName: string, sheet: string, cell: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const c = table.cells['${esc(cell)}'];
    JSON.stringify({address: '${esc(cell)}', value: c.value(), formattedValue: c.formattedValue()});
  `;
}

export function setCellScript(documentName: string, sheet: string, cell: string, value: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    table.cells['${esc(cell)}'].value = '${esc(value)}';
    JSON.stringify({written: true, address: '${esc(cell)}'});
  `;
}

export function readCellsScript(
  documentName: string,
  sheet: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const colCount = table.columnCount();
    const allValues = table.cells.value();
    const rows = [];
    for (let r = ${startRow}; r <= ${endRow}; r++) {
      const row = [];
      for (let c = ${startCol}; c <= ${endCol}; c++) {
        try {
          row.push(allValues[r * colCount + c]);
        } catch(e) { row.push(null); }
      }
      rows.push(row);
    }
    JSON.stringify({rows: rows, startRow: ${startRow}, startCol: ${startCol}, endRow: ${endRow}, endCol: ${endCol}});
  `;
}

export function addSheetScript(documentName: string, sheetName: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheet = Numbers.Sheet({name: '${esc(sheetName)}'});
    docs[0].sheets.push(sheet);
    JSON.stringify({created: true, name: '${esc(sheetName)}'});
  `;
}

export function exportPdfScript(documentName: string, outputPath: string): string {
  return iworkExportPdfScript("Numbers", documentName, outputPath);
}

export function closeDocumentScript(documentName: string, saving: boolean): string {
  return iworkCloseDocumentScript("Numbers", documentName, saving);
}

/** RFC 0009 Phase 1 — list every table in a sheet with size + headers.
 *  Numbers documents commonly hold multiple side-by-side tables per sheet
 *  (totals + breakdown + chart-source). The existing tools assumed
 *  `sheet.tables[0]` was canonical; this lets a tool consumer pick the
 *  right one by name before reading. */
export function listTablesScript(documentName: string, sheet: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheets = docs[0].sheets.whose({name: '${esc(sheet)}'})();
    if (sheets.length === 0) throw new Error('Sheet not found: ${esc(sheet)}');
    const tables = sheets[0].tables();
    const result = tables.map(t => ({
      name: t.name(),
      rowCount: t.rowCount(),
      columnCount: t.columnCount(),
    }));
    JSON.stringify(result);
  `;
}

/** RFC 0009 Phase 1 — read the formula behind a cell instead of its
 *  evaluated value. \`numbers_get_cell\` returns the computed result;
 *  \`numbers_get_formula\` returns the literal expression so a model
 *  can audit / clone / template it. Returns null \`formula\` for cells
 *  that hold a constant. */
export function getFormulaScript(documentName: string, sheet: string, cell: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const c = table.cells['${esc(cell)}'];
    let formula = null;
    try { formula = c.formula(); } catch (e) { /* no formula on this cell */ }
    JSON.stringify({
      address: '${esc(cell)}',
      formula: formula,
      value: c.value(),
      formattedValue: c.formattedValue(),
    });
  `;
}

/** RFC 0009 Phase 1 — rename a sheet in place. Numbers does NOT support
 *  duplicate sheet names so the JXA call throws when the new name is
 *  already taken; we surface that as a clean errJxa. */
export function renameSheetScript(documentName: string, sheet: string, newName: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheets = docs[0].sheets.whose({name: '${esc(sheet)}'})();
    if (sheets.length === 0) throw new Error('Sheet not found: ${esc(sheet)}');
    sheets[0].name = '${esc(newName)}';
    JSON.stringify({renamed: true, from: '${esc(sheet)}', to: '${esc(newName)}'});
  `;
}

/** RFC 0009 Phase 1 batch 2 — list every chart in a sheet with name + type
 *  + source range. Symmetric to listTablesScript: a Numbers sheet can
 *  carry multiple charts (revenue trend + pie of segments + bar of regions),
 *  so a model picking which one to update needs to enumerate them first. */
export function listChartsScript(documentName: string, sheet: string): string {
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheets = docs[0].sheets.whose({name: '${esc(sheet)}'})();
    if (sheets.length === 0) throw new Error('Sheet not found: ${esc(sheet)}');
    const charts = sheets[0].charts();
    const result = charts.map(ch => {
      let chartType = null;
      try { chartType = ch.chartType(); } catch (e) { /* not exposed on every variant */ }
      let chartName = null;
      try { chartName = ch.name(); } catch (e) { /* default-named chart */ }
      return { name: chartName, chartType: chartType };
    });
    JSON.stringify(result);
  `;
}

/** RFC 0009 Phase 1 batch 2 — write a literal formula expression to a cell.
 *  Symmetric to getFormulaScript. Numbers' \`.formula\` setter parses the
 *  expression on assignment; \`=\` prefix normalised on the TS side so the
 *  call works whether the model emits "=SUM(A1:A10)" or "SUM(A1:A10)".
 *  Errors in the formula (bad reference, unknown function) surface as
 *  errJxa with the Numbers-side parse message. */
export function setFormulaScript(documentName: string, sheet: string, cell: string, formula: string): string {
  const normalized = formula.startsWith("=") ? formula : "=" + formula;
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    table.cells['${esc(cell)}'].formula = '${esc(normalized)}';
    JSON.stringify({written: true, address: '${esc(cell)}', formula: '${esc(normalized)}'});
  `;
}

/** RFC 0009 Phase 1 batch 2 — bulk-write a 2D rectangular block of values
 *  starting at a top-left cell address. Implemented as a set_cell loop
 *  (no special Numbers JXA bulk-write verb exists in the public dictionary).
 *  Cell addresses are computed from the start anchor + (row, col) offsets
 *  using A1-style notation (A1, B1, ..., Z1, AA1, AB1, ...). Each cell
 *  string value is set via \`.value = ...\`; if the value starts with \`=\`,
 *  Numbers parses it as a formula automatically — same semantics as
 *  set_cell. Returns the count of cells written. */
export function setRangeScript(documentName: string, sheet: string, startCell: string, values: string[][]): string {
  // Pre-compute the JXA payload as a JSON literal so the script doesn't have
  // to splice arbitrary user content into JS string literals row-by-row.
  // The double-stringify dance escapes embedded quotes correctly.
  const payload = JSON.stringify(values);
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const start = '${esc(startCell)}';
    const m = start.match(/^([A-Z]+)([0-9]+)$/);
    if (!m) throw new Error('Invalid start cell address: ' + start);
    function colToNum(col) {
      let n = 0;
      for (const c of col) { n = n * 26 + (c.charCodeAt(0) - 64); }
      return n;
    }
    function numToCol(n) {
      let s = '';
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    }
    const startCol = colToNum(m[1]);
    const startRow = parseInt(m[2], 10);
    const values = ${payload};
    let written = 0;
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const addr = numToCol(startCol + c) + (startRow + r);
        table.cells[addr].value = values[r][c];
        written++;
      }
    }
    JSON.stringify({written: written, startCell: start, rows: values.length, cols: values[0] ? values[0].length : 0});
  `;
}

/** RFC 0009 Phase 1 batch 2 — resize a table by setting its rowCount /
 *  columnCount in place. Numbers' JXA exposes both as settable integer
 *  properties. Growing the table appends empty rows/columns on the
 *  bottom/right; shrinking discards the trailing rows/columns AND THEIR
 *  CONTENT — so this is destructiveHint: true. The PR uses it as the
 *  primitive for future insert_row / append_row tools that don't need a
 *  positional insert verb. */
export function resizeTableScript(
  documentName: string,
  sheet: string,
  rowCount: number | null,
  columnCount: number | null,
): string {
  const setRow = rowCount !== null ? `table.rowCount = ${rowCount};` : "";
  const setCol = columnCount !== null ? `table.columnCount = ${columnCount};` : "";
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const before = { rowCount: table.rowCount(), columnCount: table.columnCount() };
    ${setRow}
    ${setCol}
    const after = { rowCount: table.rowCount(), columnCount: table.columnCount() };
    JSON.stringify({resized: true, before: before, after: after});
  `;
}
