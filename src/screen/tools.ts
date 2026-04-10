import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { readFile, stat, unlink } from "node:fs/promises";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okUntrusted, toolError } from "../shared/result.js";
import {
  captureScreenScript,
  captureWindowScript,
  captureAreaScript,
  listWindowsScript,
  recordScreenScript,
} from "./scripts.js";
import { BUFFER } from "../shared/constants.js";

/**
 * Run a JXA capture script that returns { path: string },
 * read the resulting PNG as base64, clean up the temp file,
 * and return MCP image content.
 */
async function captureAndReturn(script: string) {
  const result = await runJxa<{ path: string }>(script);
  const filePath = result.path;
  try {
    // Check file size BEFORE reading into memory to avoid OOM on huge screenshots
    const { size } = await stat(filePath);
    if (size > BUFFER.CAPTURE) {
      try {
        await unlink(filePath);
      } catch {
        /* ignore */
      }
      throw new Error("Screenshot too large (>5MB). Use capture_area for a smaller region or reduce resolution.");
    }
    const buffer = await readFile(filePath);
    const base64 = buffer.toString("base64");
    return {
      content: [{ type: "image" as const, data: base64, mimeType: "image/png" }],
    };
  } finally {
    try {
      await unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function registerScreenTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "capture_screen",
    {
      title: "Capture Screen",
      description:
        "Capture a full-screen screenshot as a PNG image. Optionally specify a display number for multi-monitor setups (1 = main display). Requires Screen Recording permission.",
      inputSchema: {
        display: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Display number for multi-monitor setups (1 = main display). Omit for default display."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ display }) => {
      try {
        return await captureAndReturn(captureScreenScript(display));
      } catch (e) {
        return toolError("capture screen", e);
      }
    },
  );

  server.registerTool(
    "capture_window",
    {
      title: "Capture Window",
      description:
        "Capture a screenshot of the frontmost window. Optionally specify an app name to activate that app first and capture its window. Requires Screen Recording permission.",
      inputSchema: {
        appName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Application name to activate before capture (e.g. 'Safari', 'Xcode'). If omitted, captures the frontmost window.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ appName }) => {
      try {
        return await captureAndReturn(captureWindowScript(appName));
      } catch (e) {
        return toolError("capture window", e);
      }
    },
  );

  server.registerTool(
    "capture_area",
    {
      title: "Capture Screen Area",
      description:
        "Capture a screenshot of a specific rectangular region of the screen. Coordinates are in screen pixels with origin at top-left. Requires Screen Recording permission.",
      inputSchema: {
        x: z.number().describe("X coordinate of the top-left corner of the capture region"),
        y: z.number().describe("Y coordinate of the top-left corner of the capture region"),
        width: z.number().min(1).describe("Width of the capture region in pixels"),
        height: z.number().min(1).describe("Height of the capture region in pixels"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ x, y, width, height }) => {
      try {
        return await captureAndReturn(captureAreaScript(x, y, width, height));
      } catch (e) {
        return toolError("capture area", e);
      }
    },
  );

  server.registerTool(
    "list_windows",
    {
      title: "List Windows",
      description:
        "List all visible windows across all running applications. Returns JSON with each window's app name, bundle ID, title, position, and size. Requires Accessibility permissions.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        return okUntrusted(await runJxa(listWindowsScript()));
      } catch (e) {
        return toolError("list windows", e);
      }
    },
  );

  server.registerTool(
    "record_screen",
    {
      title: "Record Screen",
      description:
        "Record the screen for a specified duration (1-60 seconds). Returns the recording as a .mov file path. Requires Screen Recording permission.",
      inputSchema: {
        duration: z.number().int().min(1).max(60).describe("Recording duration in seconds (1-60)"),
        display: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Display number for multi-monitor setups (1 = main display). Omit for default display."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ duration, display }, extra) => {
      try {
        const progressToken = extra._meta?.progressToken;
        const recordPromise = runJxa<{ path: string; duration: number }>(recordScreenScript(duration, display));

        // Send progress updates while recording
        if (progressToken !== undefined) {
          const start = Date.now();
          let timerCleared = false;
          const timer = setInterval(async () => {
            if (timerCleared) return;
            const elapsed = Math.min(Math.round((Date.now() - start) / 1000), duration);
            try {
              await extra.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: elapsed,
                  total: duration,
                  message: `Recording: ${elapsed}/${duration}s`,
                },
              });
            } catch {
              /* notification failure is non-fatal */
            }
            if (elapsed >= duration) {
              timerCleared = true;
              clearInterval(timer);
            }
          }, 500);
          recordPromise.finally(() => {
            timerCleared = true;
            clearInterval(timer);
          });
        }

        const result = await recordPromise;
        const { size } = await stat(result.path);
        if (size > BUFFER.CAPTURE) {
          try {
            await unlink(result.path);
          } catch {
            /* ignore */
          }
          throw new Error("Recording too large (>5MB). Use a shorter duration or smaller region.");
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                path: result.path,
                duration: result.duration,
                message: `Screen recorded for ${result.duration}s. File saved to ${result.path}`,
              }),
            },
          ],
        };
      } catch (e) {
        return toolError("record screen", e);
      }
    },
  );
}
