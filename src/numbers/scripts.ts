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

/** RFC 0009 Phase 1 batch 3 — insert an empty row before the row at
 *  \`atIndex\` (0-based). Uses JXA's standard \`make new\` with an \`at\`
 *  reference. If \`atIndex >= rowCount\`, the row is appended at the end
 *  (matches Numbers' "add new row" UI behavior at the bottom).
 *
 *  Returns the new rowCount after insertion. */
export function insertRowScript(documentName: string, sheet: string, atIndex: number): string {
  const safeIndex = Math.max(0, Math.floor(atIndex));
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const before = table.rowCount();
    if (${safeIndex} >= before) {
      // Append at end: grow rowCount by 1 (fastest, no Numbers.make needed).
      table.rowCount = before + 1;
    } else {
      // Insert before the target row using JXA's 'make new' + 'at' clause.
      Numbers.make({new: 'row', at: table.rows[${safeIndex}]});
    }
    JSON.stringify({inserted: true, atIndex: ${safeIndex}, before: before, after: table.rowCount()});
  `;
}

/** RFC 0009 Phase 1 batch 3 — insert an empty column before the column at
 *  \`atIndex\` (0-based). Symmetric to insertRowScript. */
export function insertColumnScript(documentName: string, sheet: string, atIndex: number): string {
  const safeIndex = Math.max(0, Math.floor(atIndex));
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const before = table.columnCount();
    if (${safeIndex} >= before) {
      table.columnCount = before + 1;
    } else {
      Numbers.make({new: 'column', at: table.columns[${safeIndex}]});
    }
    JSON.stringify({inserted: true, atIndex: ${safeIndex}, before: before, after: table.columnCount()});
  `;
}

/** RFC 0009 Phase 1 batch 3 — delete the row at \`atIndex\` (0-based).
 *  Destructive: the row AND ITS CONTENT are removed. JXA's standard
 *  \`.delete()\` verb on the row reference handles the deletion. */
export function deleteRowScript(documentName: string, sheet: string, atIndex: number): string {
  const safeIndex = Math.max(0, Math.floor(atIndex));
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const before = table.rowCount();
    if (${safeIndex} >= before) {
      throw new Error('Row index ${safeIndex} out of bounds (rowCount=' + before + ')');
    }
    table.rows[${safeIndex}].delete();
    JSON.stringify({deleted: true, atIndex: ${safeIndex}, before: before, after: table.rowCount()});
  `;
}

/** RFC 0009 Phase 1 batch 3 — delete the column at \`atIndex\` (0-based).
 *  Destructive: column + content removed. Symmetric to deleteRowScript. */
export function deleteColumnScript(documentName: string, sheet: string, atIndex: number): string {
  const safeIndex = Math.max(0, Math.floor(atIndex));
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    ${sheetTableLookup(sheet)}
    const before = table.columnCount();
    if (${safeIndex} >= before) {
      throw new Error('Column index ${safeIndex} out of bounds (columnCount=' + before + ')');
    }
    table.columns[${safeIndex}].delete();
    JSON.stringify({deleted: true, atIndex: ${safeIndex}, before: before, after: table.columnCount()});
  `;
}

/** RFC 0009 Phase 1 batch 3 — duplicate a sheet, optionally giving it a
 *  new name. Uses JXA's standard \`.duplicate()\` verb. If \`newName\` is
 *  provided AND already exists, Numbers will refuse (no duplicate names)
 *  and the call throws — surfaced as errJxa. */
export function duplicateSheetScript(documentName: string, sheet: string, newName: string | null): string {
  const renameStep = newName ? `dup.name = '${esc(newName)}';` : "/* no rename — Numbers auto-suffixes */";
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheets = docs[0].sheets.whose({name: '${esc(sheet)}'})();
    if (sheets.length === 0) throw new Error('Sheet not found: ${esc(sheet)}');
    const dup = sheets[0].duplicate();
    ${renameStep}
    JSON.stringify({duplicated: true, source: '${esc(sheet)}', newName: dup.name()});
  `;
}

/** RFC 0009 Phase 1 batch 3 — create a new table on a sheet with given
 *  dimensions. Uses JXA's \`make new table\` with optional \`withProperties\`.
 *  Returns the new table's auto-assigned name (or supplied name). */
export function createTableScript(
  documentName: string,
  sheet: string,
  rowCount: number,
  columnCount: number,
  name: string | null,
): string {
  const safeRows = Math.max(1, Math.floor(rowCount));
  const safeCols = Math.max(1, Math.floor(columnCount));
  const propsParts: string[] = [`rowCount: ${safeRows}`, `columnCount: ${safeCols}`];
  if (name) propsParts.push(`name: '${esc(name)}'`);
  return `
    const Numbers = Application('com.apple.Numbers');
    ${iworkDocLookup("Numbers", documentName)}
    const sheets = docs[0].sheets.whose({name: '${esc(sheet)}'})();
    if (sheets.length === 0) throw new Error('Sheet not found: ${esc(sheet)}');
    const newTable = Numbers.make({
      new: 'table',
      at: sheets[0],
      withProperties: {${propsParts.join(", ")}}
    });
    JSON.stringify({created: true, name: newTable.name(), rowCount: newTable.rowCount(), columnCount: newTable.columnCount()});
  `;
}
