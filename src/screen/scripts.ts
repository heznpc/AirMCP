// Scripts and shell command helpers for macOS screen capture and window enumeration.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { esc, escJxaShell } from "../shared/esc.js";
import { PATHS } from "../shared/constants.js";

const SCREENCAPTURE = "/usr/sbin/screencapture";

/**
 * Build a temp file path for a screenshot.
 * A UUID prevents same-millisecond concurrent calls from sharing a file.
 * Honors AIRMCP_TEMP_DIR (PATHS.TEMP_DIR) so sandboxed runtimes can redirect
 * intermediate captures off /tmp.
 */
function tempScreenshotPath(): string {
  return join(PATHS.TEMP_DIR, `airmcp-screenshot-${Date.now()}-${randomUUID()}.png`);
}

function tempRecordingPath(): string {
  return join(PATHS.TEMP_DIR, `airmcp-recording-${Date.now()}-${randomUUID()}.mov`);
}

/** Encode one path for both places it enters generated source: the shell
 * double-quoted argument nested inside a JXA single-quoted string, and the
 * separate JXA result literal returned to Node. */
function encodedCapturePath(filePath: string): { shell: string; jxa: string } {
  return { shell: escJxaShell(filePath), jxa: esc(filePath) };
}

/** Fail with an actionable error before invoking screencapture. This tool
 * path intentionally uses the read-only preflight API rather than surprising
 * the user with a consent prompt, so a denial must point at System Settings
 * instead of surfacing the CLI's ambiguous "could not create image" message. */
const SCREEN_RECORDING_PREFLIGHT = `
    ObjC.import('CoreGraphics');
    ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
    if (!$.CGPreflightScreenCaptureAccess()) {
      throw new Error('Screen Recording permission denied for the app hosting AirMCP.');
    }
`;

/**
 * Capture the full screen (or a specific display) using macOS screencapture CLI.
 * Returns a JXA script that runs screencapture and outputs the file path as JSON.
 */
export function captureScreenScript(display?: number): string {
  const filePath = tempScreenshotPath();
  const encodedPath = encodedCapturePath(filePath);
  const displayFlag = display !== undefined ? ` -D ${Math.floor(display)}` : "";
  return `
    ${SCREEN_RECORDING_PREFLIGHT}
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('${SCREENCAPTURE} -x -t png${displayFlag} "${encodedPath.shell}"');
    JSON.stringify({ path: '${encodedPath.jxa}' });
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
  const encodedPath = encodedCapturePath(filePath);
  const activateBlock = appName ? `Application('${esc(appName)}').activate(); delay(1.0);` : "";
  const ownerFilter = appName ? `win.kCGWindowOwnerName !== '${esc(appName)}'` : "false";
  return `
    ${SCREEN_RECORDING_PREFLIGHT}
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    ${activateBlock}
    const windowListRef = $.CGWindowListCopyWindowInfo(
      $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
      0
    );
    const windowInfo = windowListRef
      ? ObjC.deepUnwrap(ObjC.castRefToObject(windowListRef))
      : [];
    let wid = 0;
    for (let i = 0; i < windowInfo.length; i++) {
      const win = windowInfo[i];
      if (Number(win.kCGWindowLayer) !== 0 || ${ownerFilter}) continue;
      wid = Number(win.kCGWindowNumber) || 0;
      if (wid > 0) break;
    }
    if (wid <= 0) {
      throw new Error('No capturable window found for the requested application.');
    }
    app.doShellScript('${SCREENCAPTURE} -x -t png -l ' + wid + ' "${encodedPath.shell}"');
    JSON.stringify({ path: '${encodedPath.jxa}' });
  `;
}

/**
 * Record the screen for a specified duration.
 * Uses screencapture -v (video mode) with a timeout to stop recording.
 */
export function recordScreenScript(duration: number, display?: number): string {
  const safeDuration = Math.min(Math.max(Math.floor(duration), 1), 60);
  const filePath = tempRecordingPath();
  const encodedPath = encodedCapturePath(filePath);
  const displayFlag = display !== undefined ? ` -D ${Math.floor(display)}` : "";
  return `
    ${SCREEN_RECORDING_PREFLIGHT}
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('${SCREENCAPTURE} -x -v${displayFlag} "${encodedPath.shell}" & SCPID=$!; sleep ${safeDuration}; kill $SCPID 2>/dev/null; wait $SCPID 2>/dev/null || true');
    JSON.stringify({ path: '${encodedPath.jxa}', duration: ${safeDuration} });
  `;
}

/**
 * Capture a specific screen region defined by x, y, width, height.
 */
export function captureAreaScript(x: number, y: number, width: number, height: number): string {
  const filePath = tempScreenshotPath();
  const encodedPath = encodedCapturePath(filePath);
  const safeX = Math.floor(x);
  const safeY = Math.floor(y);
  const safeW = Math.floor(width);
  const safeH = Math.floor(height);
  return `
    ${SCREEN_RECORDING_PREFLIGHT}
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('${SCREENCAPTURE} -x -t png -R ${safeX},${safeY},${safeW},${safeH} "${encodedPath.shell}"');
    JSON.stringify({ path: '${encodedPath.jxa}' });
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
