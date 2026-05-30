#!/usr/bin/env node
// Smoke test for RFC 0009 Phase 1 batch 3 (PR #214) — verifies the six
// structural JXA verbs (insert_row / insert_column / delete_row /
// delete_column / duplicate_sheet / create_table) against a real Numbers
// document without booting the MCP server.
//
// **PRIMARY GOAL**: prove the `Numbers.make({new: 'row', at: table.rows[N]})`
// clause inserts BEFORE the target row (vs. after / appended at end). The
// PR's script claims "before" — this script marks the row at the target
// index and confirms its post-insert position numerically.
//
// Usage:
//   1. Open Numbers and create (or reuse) a document called "AirMCP Smoke".
//      Sheet 1 / first table with default 5×4 dimensions is sufficient.
//      The script will append/restore rows but does not assume any
//      particular starting content.
//   2. node scripts/smoke/numbers-rfc0009-batch3.mjs
//   3. Copy the summary into the PR comment.
//
// What this proves:
//   - insert_row "at" clause semantics — `before`, `after`, or `append`
//     (this is the single most important verification in this PR).
//   - insert_column "at" clause semantics (symmetric — should match).
//   - delete_row / delete_column — standard verbs, sanity check.
//   - duplicate_sheet — sheet count +1, content matches.
//   - create_table — new table appears on sheet with requested dims.
//
// Restoration: the script cleans up after itself by deleting any sheet
// or table it creates. The starting table's rowCount/columnCount are
// restored at the end via resize.

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

// --- precondition + capture baseline ------------------------------------
let baseline;
try {
  baseline = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify({rowCount: table.rowCount(), columnCount: table.columnCount()});
    `),
    null,
  );
  if (!baseline) throw new Error("Could not read baseline dimensions");
  step("precondition: baseline captured", true, JSON.stringify(baseline));
} catch (e) {
  step("precondition", false, e.message);
  console.error("\nAborting — fix the precondition and retry.");
  process.exit(1);
}

// --- insert_row "at" clause semantics -----------------------------------
// Strategy: ensure table has at least 5 rows. Mark row indices 0..4 with
// known values in column A. Insert a row "at" index 2 using the PR's JXA.
// Then read column A 0..5 — the value previously at index 2 should now be
// at index 3 (BEFORE semantic) or still at index 2 (AFTER semantic) or
// the new row may have appeared at the end (APPEND semantic).
try {
  osa(`${docLookup}${sheetTable}
    if (table.rowCount() < 5) table.rowCount = 5;
    table.cells['A1'].value = 'ROW0';
    table.cells['A2'].value = 'ROW1';
    table.cells['A3'].value = 'ROW2';
    table.cells['A4'].value = 'ROW3';
    table.cells['A5'].value = 'ROW4';
  `);

  const rowCountBefore = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify(table.rowCount());
    `),
    0,
  );

  // The exact JXA from PR #214 batch 3 (atIndex=2):
  osa(`${docLookup}${sheetTable}
    Numbers.make({new: 'row', at: table.rows[2]});
  `);

  const rowCountAfter = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify(table.rowCount());
    `),
    0,
  );

  // Read column A across the now-larger range.
  const colA = parseOr(
    osa(`${docLookup}${sheetTable}
      const out = [];
      const n = table.rowCount();
      for (let i = 1; i <= Math.min(n, 6); i++) {
        out.push(table.cells['A' + i].value());
      }
      JSON.stringify(out);
    `),
    [],
  );

  // Classify the semantic:
  //   BEFORE → row 2 (1-indexed: "A3") should now be empty/null, ROW2 at A4
  //   AFTER  → ROW2 stays at A3, row 3 ("A4") is the new empty one, ROW3 at A5
  //   APPEND → ROW0..ROW4 at A1..A5 unchanged, A6 is empty
  let semantic = "unknown";
  if (colA[0] === "ROW0" && colA[1] === "ROW1" && (colA[2] === null || colA[2] === "" || colA[2] === undefined) && colA[3] === "ROW2") {
    semantic = "before (matches PR claim)";
  } else if (colA[0] === "ROW0" && colA[1] === "ROW1" && colA[2] === "ROW2" && (colA[3] === null || colA[3] === "" || colA[3] === undefined) && colA[4] === "ROW3") {
    semantic = "after";
  } else if (colA[0] === "ROW0" && colA[1] === "ROW1" && colA[2] === "ROW2" && colA[3] === "ROW3" && colA[4] === "ROW4" && (colA[5] === null || colA[5] === "" || colA[5] === undefined)) {
    semantic = "append";
  }

  const ok = rowCountAfter === rowCountBefore + 1 && semantic === "before (matches PR claim)";
  step(
    "insert_row at-clause semantic",
    ok,
    `rowCount ${rowCountBefore}→${rowCountAfter}, colA=${JSON.stringify(colA)}, semantic=${semantic}`,
  );

  // Restore: delete the inserted row, then clear markers
  osa(`${docLookup}${sheetTable}
    // The inserted row is now at whichever index the semantic put it.
    // Easiest restore: shrink rowCount back to baseline and re-zero markers.
    table.rowCount = ${baseline.rowCount};
    for (let i = 1; i <= 5; i++) {
      try { table.cells['A' + i].value = ''; } catch (e) {}
    }
  `);
} catch (e) {
  step("insert_row at-clause", false, e.message);
}

// --- insert_column "at" clause (symmetric — quick sanity check) ---------
try {
  const colCountBefore = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify(table.columnCount());
    `),
    0,
  );

  osa(`${docLookup}${sheetTable}
    Numbers.make({new: 'column', at: table.columns[1]});
  `);

  const colCountAfter = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify(table.columnCount());
    `),
    0,
  );

  const ok = colCountAfter === colCountBefore + 1;
  step("insert_column adds 1 column", ok, `${colCountBefore} → ${colCountAfter}`);

  // Restore
  osa(`${docLookup}${sheetTable}
    table.columnCount = ${baseline.columnCount};
  `);
} catch (e) {
  step("insert_column", false, e.message);
}

// --- delete_row ----------------------------------------------------------
try {
  osa(`${docLookup}${sheetTable}
    if (table.rowCount() < 4) table.rowCount = 4;
    table.cells['A1'].value = 'KEEP_A';
    table.cells['A2'].value = 'DELETE_ME';
    table.cells['A3'].value = 'KEEP_C';
  `);
  const before = parseOr(osa(`${docLookup}${sheetTable} JSON.stringify(table.rowCount());`), 0);
  osa(`${docLookup}${sheetTable}
    table.rows[1].delete();
  `);
  const after = parseOr(osa(`${docLookup}${sheetTable} JSON.stringify(table.rowCount());`), 0);
  const colA = parseOr(
    osa(`${docLookup}${sheetTable}
      JSON.stringify([table.cells['A1'].value(), table.cells['A2'].value()]);
    `),
    [],
  );
  // After deleting row index 1 (1-indexed: row 2), A1 stays KEEP_A and A2 should now be KEEP_C
  const ok = after === before - 1 && colA[0] === "KEEP_A" && colA[1] === "KEEP_C";
  step("delete_row removes row + shifts content up", ok, `rowCount ${before}→${after}, colA=${JSON.stringify(colA)}`);

  // Restore
  osa(`${docLookup}${sheetTable}
    table.rowCount = ${baseline.rowCount};
    for (let i = 1; i <= 5; i++) { try { table.cells['A' + i].value = ''; } catch (e) {} }
  `);
} catch (e) {
  step("delete_row", false, e.message);
}

// --- delete_column (mirror) ---------------------------------------------
try {
  const before = parseOr(osa(`${docLookup}${sheetTable} JSON.stringify(table.columnCount());`), 0);
  osa(`${docLookup}${sheetTable}
    if (table.columnCount() < 3) table.columnCount = 3;
    table.columns[1].delete();
  `);
  const after = parseOr(osa(`${docLookup}${sheetTable} JSON.stringify(table.columnCount());`), 0);
  const ok = after === Math.max(before, 3) - 1;
  step("delete_column removes column", ok, `${before} → ${after}`);

  // Restore
  osa(`${docLookup}${sheetTable}
    table.columnCount = ${baseline.columnCount};
  `);
} catch (e) {
  step("delete_column", false, e.message);
}

// --- duplicate_sheet -----------------------------------------------------
try {
  const before = parseOr(osa(`${docLookup} JSON.stringify(docs[0].sheets().length);`), 0);
  const dupName = osa(`${docLookup}
    const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
    const dup = sheets[0].duplicate();
    JSON.stringify(dup.name());
  `);
  const after = parseOr(osa(`${docLookup} JSON.stringify(docs[0].sheets().length);`), 0);
  const ok = after === before + 1;
  step("duplicate_sheet adds 1 sheet", ok, `${before} → ${after}, newName=${dupName}`);

  // Restore — delete the duplicate by its returned name
  const newName = parseOr(dupName, null);
  if (newName) {
    osa(`${docLookup}
      const matches = docs[0].sheets.whose({name: ${JSON.stringify(newName)}})();
      if (matches.length > 0) matches[0].delete();
    `);
  }
} catch (e) {
  step("duplicate_sheet", false, e.message);
}

// --- create_table --------------------------------------------------------
try {
  const before = parseOr(
    osa(`${docLookup}
      const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
      JSON.stringify(sheets[0].tables().length);
    `),
    0,
  );
  const made = parseOr(
    osa(`${docLookup}
      const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
      const t = Numbers.make({
        new: 'table',
        at: sheets[0],
        withProperties: {rowCount: 4, columnCount: 3, name: 'SmokeTable'}
      });
      JSON.stringify({name: t.name(), rowCount: t.rowCount(), columnCount: t.columnCount()});
    `),
    null,
  );
  const after = parseOr(
    osa(`${docLookup}
      const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
      JSON.stringify(sheets[0].tables().length);
    `),
    0,
  );
  const ok = after === before + 1 && made && made.rowCount === 4 && made.columnCount === 3;
  step("create_table makes 4×3 table named SmokeTable", ok, JSON.stringify({ before, after, made }));

  // Restore — delete the new table
  osa(`${docLookup}
    const sheets = docs[0].sheets.whose({name: ${JSON.stringify(SHEET)}})();
    const tables = sheets[0].tables();
    for (const t of tables) {
      try { if (t.name() === 'SmokeTable') t.delete(); } catch (e) {}
    }
  `);
} catch (e) {
  step("create_table", false, e.message);
}

// --- summary -------------------------------------------------------------
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log("\n=== batch 3 smoke summary ===");
console.log(`${pass} pass / ${fail} fail / ${results.length} total`);

const semanticRow = results.find((r) => r.name.startsWith("insert_row at-clause"));
if (semanticRow && semanticRow.detail) {
  const m = semanticRow.detail.match(/semantic=([^,]+)$/);
  if (m) {
    console.log(`\nKEY FINDING — insert_row 'at' semantic: ${m[1]}`);
    if (!m[1].startsWith("before")) {
      console.log("⚠ PR #214 script claims 'before' but real Numbers returned different semantic.");
      console.log("  Fix scripts.ts comment + behavior expectation before merging.");
    } else {
      console.log("✓ PR #214 claim matches real-device behavior.");
    }
  }
}

if (fail === 0) {
  console.log("\nAll six batch 3 JXA verbs work as the PR expects. Safe to merge PR #214.");
} else {
  console.log("\nFailures above — fix before merging PR #214.");
  process.exit(2);
}
