// Scripts and shell command helpers for macOS screen capture and window enumeration.

import { join } from "node:path";
import { esc } from "../shared/esc.js";
import { PATHS } from "../shared/constants.js";

/**
 * Build a temp file path for a screenshot.
 * Uses a timestamp to avoid collisions. Honors AIRMCP_TEMP_DIR (PATHS.TEMP_DIR)
 * so sandboxed runtimes can redirect intermediate captures off /tmp.
 */
function tempScreenshotPath(): string {
  return join(PATHS.TEMP_DIR, `airmcp-screenshot-${Date.now()}.png`);
}

/**
 * Capture the full screen (or a specific display) using macOS screencapture CLI.
 * Returns a JXA script that runs screencapture and outputs the file path as JSON.
 */
export function captureScreenScript(display?: number): string {
  const filePath = tempScreenshotPath();
  const displayFlag = display !== undefined ? ` -D ${Math.floor(display)}` : "";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('screencapture -x -t png${displayFlag} "${filePath}"');
    JSON.stringify({ path: '${filePath}' });
  `;
}

/**
 * Capture a specific app window autonomously (no user interaction).
 * Uses CGWindowListCopyWindowInfo to find the window ID, then screencapture -l <id>.
 * If appName is given, activates that app and captures its frontmost window.
 * If omitted, captures the frontmost window of the frontmost app.
 */
export function captureWindowScript(appName?: string): string {
  const filePath = tempScreenshotPath();
  const activateBlock = appName ? `Application('${esc(appName)}').activate(); delay(1.0);` : "";
  // To avoid JXA→shell→Python multi-layer escaping pitfalls, pass the app name
  // as a base64 literal. Base64 output is [A-Za-z0-9+/=] only — safe in all layers.
  const b64 = appName ? Buffer.from(appName).toString("base64") : "";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    ${activateBlock}
    // Get window ID via CGWindowListCopyWindowInfo
    ${
      appName
        ? `const pyCmd = 'python3 -c "import Quartz,base64;name=base64.b64decode(\\"${b64}\\").decode();ws=[w for w in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly|Quartz.kCGWindowListExcludeDesktopElements,Quartz.kCGNullWindowID) if w.get(\\"kCGWindowOwnerName\\")==name and w.get(\\"kCGWindowLayer\\")==0];print(ws[0][\\"kCGWindowNumber\\"] if ws else 0)"';`
        : `const pyCmd = 'python3 -c "import Quartz;ws=[w for w in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly|Quartz.kCGWindowListExcludeDesktopElements,Quartz.kCGNullWindowID) if w.get(\\"kCGWindowLayer\\")==0];print(ws[0][\\"kCGWindowNumber\\"] if ws else 0)"';`
    }
    const wid = parseInt(app.doShellScript(pyCmd).trim(), 10);
    if (wid > 0) {
      app.doShellScript('screencapture -x -t png -l ' + wid + ' "${filePath}"');
    } else {
      // Fallback: capture full screen if no window found
      app.doShellScript('screencapture -x -t png "${filePath}"');
    }
    JSON.stringify({ path: '${filePath}' });
  `;
}

/**
 * Record the screen for a specified duration.
 * Uses screencapture -v (video mode) with a timeout to stop recording.
 */
export function recordScreenScript(duration: number, display?: number): string {
  const safeDuration = Math.min(Math.max(Math.floor(duration), 1), 60);
  const filePath = join(PATHS.TEMP_DIR, `airmcp-recording-${Date.now()}.mov`);
  const displayFlag = display !== undefined ? ` -D ${Math.floor(display)}` : "";
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('screencapture -x -v${displayFlag} "${filePath}" & SCPID=$!; sleep ${safeDuration}; kill $SCPID 2>/dev/null; wait $SCPID 2>/dev/null || true');
    JSON.stringify({ path: '${filePath}', duration: ${safeDuration} });
  `;
}

/**
 * Capture a specific screen region defined by x, y, width, height.
 */
export function captureAreaScript(x: number, y: number, width: number, height: number): string {
  const filePath = tempScreenshotPath();
  const safeX = Math.floor(x);
  const safeY = Math.floor(y);
  const safeW = Math.floor(width);
  const safeH = Math.floor(height);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('screencapture -x -t png -R ${safeX},${safeY},${safeW},${safeH} "${filePath}"');
    JSON.stringify({ path: '${filePath}' });
  `;
}

/**
 * List all visible windows with their app names, titles, positions, and sizes.
 * Uses System Events to enumerate running application processes and their windows.
 */
export function listWindowsScript(): string {
  return `
    const se = Application('System Events');
    const procs = se.processes.whose({backgroundOnly: false})();
    const results = [];
    for (let p = 0; p < procs.length; p++) {
      const proc = procs[p];
      let procName = '';
      let bundleId = '';
      try { procName = proc.name(); } catch(e) { continue; }
      try { bundleId = proc.bundleIdentifier() || ''; } catch(e) {}
      let wins;
      try { wins = proc.windows(); } catch(e) { continue; }
      for (let w = 0; w < wins.length; w++) {
        const win = wins[w];
        const info = { app: procName, bundleId: bundleId, title: '', position: null, size: null };
        try { info.title = win.name() || ''; } catch(e) {}
        try { info.position = win.position(); } catch(e) {}
        try { info.size = win.size(); } catch(e) {}
        results.push(info);
      }
    }
    JSON.stringify(results);
  `;
}
