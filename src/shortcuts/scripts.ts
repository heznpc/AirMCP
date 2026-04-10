// JXA scripts for macOS Shortcuts automation.

import { join } from "node:path";
import { esc, escJxaShell } from "../shared/esc.js";
import { PATHS } from "../shared/constants.js";

export function listShortcutsScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('shortcuts list');
    const names = output.split('\\n').filter(n => n.length > 0);
    JSON.stringify({total: names.length, shortcuts: names});
  `;
}

export function runShortcutScript(name: string, input?: string): string {
  const inputPart = input !== undefined ? ` --input-type text --input "${escJxaShell(input)}"` : "";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('shortcuts run "${escJxaShell(name)}"${inputPart}');
    JSON.stringify({shortcut: '${esc(name)}', output: output});
  `;
}

export function searchShortcutsScript(query: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const output = app.doShellScript('shortcuts list');
    const names = output.split('\\n').filter(n => n.length > 0);
    const q = '${esc(query)}'.toLowerCase();
    const matches = names.filter(n => n.toLowerCase().includes(q));
    JSON.stringify({total: matches.length, shortcuts: matches});
  `;
}

export function getShortcutDetailScript(name: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    let actions = '';
    try {
      actions = app.doShellScript('shortcuts view "${escJxaShell(name)}" 2>&1 || true');
    } catch(e) {
      actions = 'Details not available';
    }
    JSON.stringify({shortcut: '${esc(name)}', detail: actions});
  `;
}

export function deleteShortcutScript(name: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('shortcuts delete "${escJxaShell(name)}"');
    JSON.stringify({deleted: '${esc(name)}', success: true});
  `;
}

export function exportShortcutScript(name: string, outputPath: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('shortcuts export "${escJxaShell(name)}" -o "${escJxaShell(outputPath)}"');
    JSON.stringify({shortcut: '${esc(name)}', exportedTo: '${esc(outputPath)}', success: true});
  `;
}

export function importShortcutScript(filePath: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('shortcuts import "${escJxaShell(filePath)}"');
    JSON.stringify({imported: '${esc(filePath)}', success: true});
  `;
}

export function duplicateShortcutScript(name: string, newName: string): string {
  const safeName = escJxaShell(newName).replace(/[^a-zA-Z0-9_-]/g, "_");
  // Inline a unique temp file path so concurrent duplicates don't collide and
  // sandboxed runtimes can redirect via AIRMCP_TEMP_DIR.
  const tempFile = join(PATHS.TEMP_DIR, `${safeName}-${Date.now()}.shortcut`);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('shortcuts export "${escJxaShell(name)}" -o "${tempFile}" && shortcuts import "${tempFile}"');
    app.doShellScript('rm -f "${tempFile}"');
    JSON.stringify({original: '${esc(name)}', duplicate: '${esc(newName)}', success: true});
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
