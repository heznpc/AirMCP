/**
 * Numbers JXA generator suite — injection focused.
 *
 * Numbers interpolates more untrusted surface than the other iWork modules:
 * document name, sheet name, cell address, new sheet name, and a cell VALUE
 * that is deliberately emitted unquoted when it is a number or boolean. That
 * last one is the interesting case — the quoting decision is made in TypeScript,
 * so these tests pin both branches.
 *
 * Row/column bounds are interpolated raw as numeric literals; the tool schema
 * constrains them to integers, and the assertions here document that contract
 * so a future change to a string-typed param is visible.
 *
 * No Numbers process is launched; only the generated source string is inspected.
 */
import { describe, test, expect } from '@jest/globals';
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
} from '../dist/numbers/scripts.js';

// The prefix is a sentinel that cannot collide with a document or sheet name
// used in these tests — reusing a real name would trip on a benign
// `not found: <name>');` line instead of on a genuine escaping failure.
const BREAKOUT = "INJECT'); Application('Finder').trash(); ('";

describe('numbers script generators — normal path', () => {
  test('listDocumentsScript targets the stable bundle id', () => {
    expect(listDocumentsScript()).toContain("Application('com.apple.Numbers')");
  });

  test('createDocumentScript pushes a new document', () => {
    const script = createDocumentScript();
    expect(script).toContain('Document()');
    expect(script).toContain('documents.push');
  });

  test('listSheetsScript reports per-sheet table counts', () => {
    const script = listSheetsScript('Budget');
    expect(script).toContain("documents.whose({name: 'Budget'})");
    expect(script).toContain('tableCount');
  });

  test('getCellScript reads value and formattedValue for the address', () => {
    const script = getCellScript('Budget', 'Q1', 'B7');
    expect(script).toContain("sheets.whose({name: 'Q1'})");
    expect(script).toContain("table.cells['B7']");
    expect(script).toContain("address: 'B7'");
    expect(script).toContain('formattedValue()');
  });

  test('readCellsScript emits its bounds as bare numeric literals', () => {
    const script = readCellsScript('Budget', 'Q1', 1, 2, 3, 4);
    expect(script).toContain('for (let r = 1; r <= 3; r++)');
    expect(script).toContain('for (let c = 2; c <= 4; c++)');
    expect(script).toContain('startRow: 1');
    expect(script).toContain('endCol: 4');
    // Bounds must not arrive quoted — a quoted bound would mean a string param
    // slipped through and the loop guard would be comparing text.
    expect(script).not.toContain("let r = '1'");
  });

  test('listTablesScript enumerates every table in the sheet', () => {
    const script = listTablesScript('Budget', 'Q1');
    expect(script).toContain("sheets.whose({name: 'Q1'})");
    expect(script).toContain('rowCount()');
    expect(script).toContain('columnCount()');
  });

  test('getFormulaScript tolerates constant cells', () => {
    const script = getFormulaScript('Budget', 'Q1', 'B7');
    expect(script).toContain('formula = c.formula()');
    expect(script).toContain('let formula = null');
  });

  test('renameSheetScript reports both names', () => {
    const script = renameSheetScript('Budget', 'Q1', 'Q1 final');
    expect(script).toContain("sheets[0].name = 'Q1 final'");
    expect(script).toContain("from: 'Q1'");
    expect(script).toContain("to: 'Q1 final'");
  });

  test('closeDocumentScript maps saving to a yes/no literal', () => {
    expect(closeDocumentScript('Budget', true)).toContain("saving: 'yes'");
    expect(closeDocumentScript('Budget', false)).toContain("saving: 'no'");
  });
});

describe('numbers setCellScript value literal', () => {
  test('numbers are emitted unquoted so the cell stays numeric', () => {
    const script = setCellScript('Budget', 'Q1', 'B7', 42.5);
    expect(script).toContain("table.cells['B7'].value = 42.5");
    expect(script).not.toContain("value = '42.5'");
  });

  test('booleans are emitted unquoted', () => {
    expect(setCellScript('Budget', 'Q1', 'B7', true)).toContain("value = true");
    expect(setCellScript('Budget', 'Q1', 'B7', false)).toContain("value = false");
  });

  test('strings are quoted and escaped', () => {
    const script = setCellScript('Budget', 'Q1', 'B7', "O'Brien");
    expect(script).toContain("value = 'O\\'Brien'");
  });

  test('a formula string stays a quoted string literal', () => {
    // Numbers interprets '=SUM(...)' as a formula on assignment, which is the
    // documented behaviour — but it must still reach Numbers as JXA data, not
    // as JXA source.
    const script = setCellScript('Budget', 'Q1', 'B7', '=SUM(A1:A10)');
    expect(script).toContain("value = '=SUM(A1:A10)'");
  });

  test('a hostile string value cannot terminate its literal', () => {
    const script = setCellScript('Budget', 'Q1', 'B7', BREAKOUT);
    expect(script).not.toContain("INJECT');");
    expect(script).toContain("INJECT\\');");
  });
});

describe('numbers esc() injection prevention', () => {
  test.each([
    ['document name', (v) => listSheetsScript(v)],
    ['sheet name', (v) => getCellScript('Doc', v, 'A1')],
    ['cell address', (v) => getCellScript('Doc', 'Q1', v)],
    ['new sheet name', (v) => addSheetScript('Doc', v)],
    ['rename target', (v) => renameSheetScript('Doc', 'Q1', v)],
    ['formula cell address', (v) => getFormulaScript('Doc', 'Q1', v)],
    ['table sheet name', (v) => listTablesScript('Doc', v)],
    ['export path', (v) => exportPdfScript('Doc', v)],
  ])('%s cannot terminate its JXA literal', (_label, build) => {
    const script = build(BREAKOUT);
    expect(script).not.toContain("INJECT');");
    expect(script).toContain("INJECT\\');");
  });

  test('a hostile sheet name is escaped in the filter and the throw message', () => {
    const script = getCellScript('Doc', "O'Brien", 'A1');
    expect(script).toContain("sheets.whose({name: 'O\\'Brien'})");
    expect(script).toContain("Sheet not found: O\\'Brien");
    expect(script).not.toMatch(/name: 'O'Brien'/);
  });

  test('a cell address is escaped in both the accessor and the echo', () => {
    const script = setCellScript('Doc', 'Q1', "A1'] = 1; x['B2", 0);
    expect(script).not.toContain("cells['A1'] = 1;");
    expect(script).toContain("A1\\'] = 1; x[\\'B2");
  });

  test('backslashes are doubled before quote escaping', () => {
    const script = addSheetScript('Doc', 'C:\\sheets\\');
    expect(script).toContain("'C:\\\\sheets\\\\'");
  });

  test('newlines become escapes, not raw line breaks', () => {
    const script = addSheetScript('Doc', 'a\nb');
    expect(script).toContain('a\\nb');
    expect(script).not.toContain('a\nb');
  });

  test('NUL and control characters are stripped', () => {
    expect(addSheetScript('Doc', 'a\u0000b\u0007c')).toContain("'abc'");
  });
});
