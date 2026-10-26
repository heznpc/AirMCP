// JXA scripts for macOS Shortcuts automation.
//
// See `src/messages/scripts.ts` header for the contract pattern. The
// interfaces + EXAMPLE constants here pin the JSON shapes each script
// produces; `tests/script-shape-contract.test.js` parses each example
// through its tool's outputSchema so a scripts-side drift breaks the build.

import { join } from "node:path";
import { esc, escJxaShell } from "../shared/esc.js";
import { PATHS } from "../shared/constants.js";

// ── Return shapes ───────────────────────────────────────────────────────
export interface ShortcutsNameList {
  total: number;
  shortcuts: string[];
}

// ── Example fixtures ────────────────────────────────────────────────────
export const LIST_SHORTCUTS_EXAMPLE: ShortcutsNameList = {
  total: 3,
  shortcuts: ["Daily Brief", "Morning Routine", "Save to Notes"],
};

export const SEARCH_SHORTCUTS_EXAMPLE: ShortcutsNameList = {
  total: 1,
  shortcuts: ["Daily Brief"],
};

export function listShortcutsScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('shortcuts list');
    const names = output.split(/[\\r\\n]+/).filter(n => n.length > 0);
    JSON.stringify({total: names.length, shortcuts: names});
  `;
}

export function runShortcutScript(name: string, input?: string): string {
  // The CLI accepts input files, not --input/--input-type. Keep text out of
  // argv, preserve its bytes with printf, and clean up even if the shortcut
  // fails. A private mktemp directory protects input.txt and its text type.
  const command =
    input === undefined
      ? `shortcuts run "${escJxaShell(name)}"`
      : String.raw`airmcp_dir=$(/usr/bin/mktemp -d "${escJxaShell(join(PATHS.TEMP_DIR, "airmcp-shortcut.XXXXXX"))}") || exit $?; airmcp_input="$airmcp_dir/input.txt"; trap \'/bin/rm -f "$airmcp_input"; /bin/rmdir "$airmcp_dir"\' 0; printf \'%s\' "${escJxaShell(input)}" >"$airmcp_input" || exit $?; shortcuts run "${escJxaShell(name)}" --input-path "$airmcp_input"`;
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('${command}');
    JSON.stringify({shortcut: '${esc(name)}', output: output});
  `;
}

export function searchShortcutsScript(query: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('shortcuts list');
    const names = output.split(/[\\r\\n]+/).filter(n => n.length > 0);
    const q = '${esc(query)}'.toLowerCase();
    const matches = names.filter(n => n.toLowerCase().includes(q));
    JSON.stringify({total: matches.length, shortcuts: matches});
  `;
}

export function editShortcutScript(name: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const se = Application('System Events');
    const shortcuts = Application('Shortcuts');
    shortcuts.activate();
    delay(1);
    se.keystroke('f', {using: 'command down'});
    delay(0.3);
    se.keystroke('${esc(name)}');
    delay(1);
    se.keyCode(36);
    delay(0.3);
    JSON.stringify({shortcut: '${esc(name)}', success: true, note: 'Opened shortcut in Shortcuts app for editing. Use the Shortcuts app UI to make changes.'});
  `;
}

export function createShortcutScript(name: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const se = Application('System Events');
    const shortcuts = Application('Shortcuts');
    shortcuts.activate();
    delay(1);
    se.keystroke('n', {using: 'command down'});
    delay(1);
    se.keystroke('${esc(name)}');
    delay(0.3);
    se.keyCode(36);
    delay(0.3);
    JSON.stringify({created: '${esc(name)}', success: true, note: 'Shortcut created via Shortcuts app UI automation. Open Shortcuts app to add actions.'});
  `;
}
