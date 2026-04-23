import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { ok, okLinked, errSwift, toolError } from "../shared/result.js";

export function registerSpeechTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "transcribe_audio",
    {
      title: "Transcribe Audio",
      description:
        "Transcribe an audio file to text using Apple's on-device speech recognition. Supports most audio formats (m4a, mp3, wav, caf).",
      inputSchema: {
        path: z.string().max(1000).describe("Absolute path to the audio file"),
        language: z
          .string()
          .optional()
          .describe("Language code (e.g. 'en-US', 'ko-KR', 'ja-JP'). Defaults to system language."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path, language }: { path: string; language?: string }) => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ text: string; segments: unknown[]; language: string; onDevice: boolean }>(
          "transcribe-audio",
          JSON.stringify({ path, language }),
        );
        return okLinked("transcribe_audio", result);
      } catch (e) {
        return toolError("transcribe audio", e);
      }
    },
  );

  server.registerTool(
    "speech_availability",
    {
      title: "Speech Recognition Status",
      description: "Check if on-device speech recognition is available and authorized.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ available: boolean; supportsOnDevice: boolean }>("speech-availability", "{}");
        return ok(result);
      } catch (e) {
        return toolError("check speech availability", e);
      }
    },
  );

  server.registerTool(
    "smart_clipboard",
    {
      title: "Smart Clipboard",
      description:
        "Get clipboard content with automatic type detection (text, URL, email, phone, date, file path, image). More structured than raw clipboard access.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{
          text: string | null;
          hasImage: boolean;
          hasURL: boolean;
          url: string | null;
          types: string[];
          changeCount: number;
          detectedType: string;
        }>("pasteboard-smart", "{}");
        return ok(result);
      } catch (e) {
        return toolError("read smart clipboard", e);
      }
    },
  );
}
