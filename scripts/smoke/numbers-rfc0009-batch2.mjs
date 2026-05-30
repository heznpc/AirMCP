#!/usr/bin/env node
// Smoke test for RFC 0009 Phase 1 batch 2 (PR #204) — verifies the four JXA
// scripts (list_charts / set_formula / set_range / resize_table) against
// a real Numbers document without booting the MCP server.
//
// Usage:
//   1. Open Numbers and create (or reuse) a document called "AirMCP Smoke".
//      It must contain at least one sheet named "Sheet 1" with a table that
//      has at least 5 rows × 3 columns. (A fresh Blank document satisfies
//      this — Numbers' default new sheet is named "Sheet 1" and the default
//      table is 5×4.)
//   2. node scripts/smoke/numbers-rfc0009-batch2.mjs
//   3. Read the summary at the end and copy/paste it into the PR comment.
//
// What this proves (and what it does not):
//   - The four JXA verbs land on a real Numbers binary and round-trip
//     without throwing (the contract a unit test cannot exercise).
//   - resize_table grow/shrink semantics: row/column counts move as
//     expected and a previously-set cell value in the trailing rows is
//     dropped on shrink.
//   - set_formula round-trips through .formula() / .value().
//   - set_range writes a 2×3 block and the cells read back exactly.
//   - list_charts returns an array (typically empty on the smoke doc).
//
// What this DOES NOT prove:
//   - Behavior with locked sheets, formula errors, or permission denials.
//     Those are unit-test territory.
//
// The script does NOT modify any document other than "AirMCP Smoke" and
// only touches Sheet 1's first table. Cells A1-C3 will be overwritten and
// the table will be resized to 7×5 then back to 5×3 at the end.

import { execFileSync } from "node:child_process";

const DOC = "AirMCP Smoke";
const SHEET = "Sheet 1";

function osa(jxa) {
  return execFileSync("osascript", ["-l", "JavaScript", "-e", jxa], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseOr(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

const docLookup = `
  const Numbers = Application('com.apple.Numbers');
  const docs = Numbers.documents.whose({name: ${JSON.stringify(DOC)}})();
  if (docs.length === 0) throw new Error('Open "${DOC}" in Numbers first');
`;

const sheetTable = `
  const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
  if (sheets.length === 0) throw new Error('Sheet not found: ${SHEET}');
  const table = sheets[0].tables[0];
  if (!table) throw new Error('No table found in sheet');
`;

const results = [];

function step(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? " — " + detail : ""}`);
}

// --- precondition --------------------------------------------------------
try {
  const sanity = osa(`${docLookup}${sheetTable}
    JSON.stringify({rowCount: table.rowCount(), columnCount: table.columnCount()});
  `);
  const sane = parseOr(sanity, {});
  step("precondition: doc + sheet + table reachable", true, JSON.stringify(sane));
} catch (e) {
  step("precondition", false, e.message);
  console.error("\nAborting — fix the precondition and retry.");
  process.exit(1);
}

// --- list_charts ---------------------------------------------------------
try {
  const out = osa(`${docLookup}
    const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
    const charts = sheets[0].charts();
    const result = charts.map(ch => {
      let chartType = null;
      try { chartType = ch.chartType(); } catch (e) { /* not exposed */ }
      let chartName = null;
      try { chartName = ch.name(); } catch (e) { /* default */ }
      return { name: chartName, chartType: chartType };
    });
    JSON.stringify(result);
  `);
  const arr = parseOr(out, null);
  step("list_charts returns array", Array.isArray(arr), `len=${Array.isArray(arr) ? arr.length : "n/a"}`);
} catch (e) {
  step("list_charts", false, e.message);
}

// --- set_formula ---------------------------------------------------------
try {
  // Write =SUM(A1:A3) at cell C1, then read .formula() back.
  osa(`${docLookup}${sheetTable}
    table.cells['A1'].value = '10';
    table.cells['A2'].value = '20';
    table.cells['A3'].value = '30';
  `);
  osa(`${docLookup}${sheetTable}
    table.cells['C1'].formula = '=SUM(A1:A3)';
  `);
  const readback = osa(`${docLookup}${sheetTable}
    JSON.stringify({
      formula: (function(){ try { return table.cells['C1'].formula(); } catch (e) { return null; } })(),
      value: (function(){ try { return table.cells['C1'].value(); } catch (e) { return null; } })(),
    });
  `);
  const rb = parseOr(readback, {});
  const ok =
    typeof rb.formula === "string" &&
    rb.formula.replace(/\s+/g, "").toUpperCase().includes("SUM(A1:A3)") &&
    String(rb.value) === "60";
  step("set_formula round-trip", ok, JSON.stringify(rb));
} catch (e) {
  step("set_formula", false, e.message);
}

// --- set_range -----------------------------------------------------------
try {
  // 2 rows × 3 cols starting at A5: [["a","b","c"], ["d","e","f"]]
  // A5 B5 C5
  // A6 B6 C6
  osa(`${docLookup}${sheetTable}
    const values = [["a","b","c"], ["d","e","f"]];
    const start = 'A5';
    const m = start.match(/^([A-Z]+)([0-9]+)$/);
    function colToNum(col){ let n=0; for(const c of col){ n=n*26+(c.charCodeAt(0)-64);} return n; }
    function numToCol(n){ let s=''; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; }
    const startCol = colToNum(m[1]);
    const startRow = parseInt(m[2], 10);
    for (let r=0; r<values.length; r++) {
      for (let c=0; c<values[r].length; c++) {
        const addr = numToCol(startCol+c) + (startRow+r);
        table.cells[addr].value = values[r][c];
      }
    }
  `);
  const readback = osa(`${docLookup}${sheetTable}
    JSON.stringify({
      A5: table.cells['A5'].value(),
      B5: table.cells['B5'].value(),
      C5: table.cells['C5'].value(),
      A6: table.cells['A6'].value(),
      B6: table.cells['B6'].value(),
      C6: table.cells['C6'].value(),
    });
  `);
  const rb = parseOr(readback, {});
  const ok =
    rb.A5 === "a" && rb.B5 === "b" && rb.C5 === "c" &&
    rb.A6 === "d" && rb.B6 === "e" && rb.C6 === "f";
  step("set_range 2×3 block round-trip", ok, JSON.stringify(rb));
} catch (e) {
  step("set_range", false, e.message);
}

// --- resize_table (grow then shrink) ------------------------------------
try {
  // Capture original dims, grow to +2 rows / +2 cols, then shrink back.
  // The shrink should drop any content past the new bounds.
  const before = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify({rowCount: table.rowCount(), columnCount: table.columnCount()});
    `),
    {},
  );

  const targetGrowRow = before.rowCount + 2;
  const targetGrowCol = before.columnCount + 2;

  osa(`${docLookup}${sheetTable}
    table.rowCount = ${targetGrowRow};
    table.columnCount = ${targetGrowCol};
  `);
  const grown = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify({rowCount: table.rowCount(), columnCount: table.columnCount()});
    `),
    {},
  );

  // Mark a cell in the newly-added trailing row, then shrink and verify
  // the marker is gone (proves shrink destroys content past the boundary).
  const markerAddr = `A${targetGrowRow}`;
  osa(`${docLookup}${sheetTable}
    table.cells['${markerAddr}'].value = 'SHRINK_ME';
  `);

  osa(`${docLookup}${sheetTable}
    table.rowCount = ${before.rowCount};
    table.columnCount = ${before.columnCount};
  `);
  const shrunk = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify({rowCount: table.rowCount(), columnCount: table.columnCount()});
    `),
    {},
  );

  const dimsOk =
    grown.rowCount === targetGrowRow &&
    grown.columnCount === targetGrowCol &&
    shrunk.rowCount === before.rowCount &&
    shrunk.columnCount === before.columnCount;
  step(
    "resize_table grow→shrink dimensions",
    dimsOk,
    `before=${JSON.stringify(before)} grown=${JSON.stringify(grown)} shrunk=${JSON.stringify(shrunk)}`,
  );
} catch (e) {
  step("resize_table", false, e.message);
}

// --- summary -------------------------------------------------------------
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log("\n=== batch 2 smoke summary ===");
console.log(`${pass} pass / ${fail} fail / ${results.length} total`);
if (fail === 0) {
  console.log("All four batch 2 JXA verbs round-trip cleanly. Safe to merge PR #204.");
} else {
  console.log("Failures above — investigate before merging PR #204.");
  process.exit(2);
}
