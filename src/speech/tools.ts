import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { ok, okLinked, errSwift, errSwiftFor } from "../shared/result.js";

export function registerSpeechTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "transcribe_audio",
    {
      title: "Transcribe Audio",
      description:
        "Transcribe an audio file to text using Apple's on-device speech recognition. Supports most audio formats (m4a, mp3, wav, caf). " +
        "Requires the responsible process to hold macOS Speech Recognition permission (the signed AirMCP app surface); from an unentitled CLI caller it aborts with a permission error.",
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
        return errSwiftFor("transcribe audio", e);
      }
    },
  );

  server.registerTool(
    "speech_availability",
    {
      title: "Speech Recognition Status",
      description:
        "Report whether this device supports on-device speech recognition. A true result is DEVICE capability only — NOT proof the caller is authorized: macOS gates transcription by Speech Recognition permission on the responsible process (the signed AirMCP app), so only a successful transcribe_audio confirms authorization.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<{ available: boolean; supportsOnDevice: boolean }>("speech-availability", "{}");
        // `available`/`supportsOnDevice` report DEVICE capability only — not that
        // the current responsible process is permitted. macOS TCC gates on-device
        // transcription against the responsible process: the signed AirMCP app
        // (NSSpeechRecognitionUsageDescription + a user-granted permission) can
        // transcribe; a generic CLI parent (terminal/node) is not entitled and
        // transcribe_audio aborts with a permission error. So availability is
        // necessary but NOT sufficient — only a successful transcribe_audio proves
        // the caller is authorized. Travel the caveat with the result so callers
        // never read `available:true` as "transcription will work".
        return ok({
          ...result,
          note: "available/supportsOnDevice = device capability only; transcription also requires the responsible process (the signed AirMCP app) to hold macOS Speech Recognition permission — a generic CLI caller is not entitled and transcribe_audio will fail. available:true does not guarantee transcription succeeds.",
        });
      } catch (e) {
        return errSwiftFor("check speech availability", e);
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
        return errSwiftFor("read smart clipboard", e);
      }
    },
  );
}
