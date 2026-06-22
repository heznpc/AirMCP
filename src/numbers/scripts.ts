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

export function setCellScript(
  documentName: string,
  sheet: string,
  cell: string,
  value: string | number | boolean,
): string {
  // Numbers and booleans are emitted as native JS literals so the cell holds a
  // real number/boolean (sortable, formula-referenceable) instead of text. Only
  // strings are quoted + escaped; a string like '=SUM(A1:A10)' is interpreted by
  // Numbers as a formula on assignment. (value is constrained to a finite
  // number / boolean / string by the tool's input schema.)
  const valueLiteral = typeof value === "string" ? `'${esc(value)}'` : String(value);
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    table.cells['${esc(cell)}'].value = ${valueLiteral};
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
