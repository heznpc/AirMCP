import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import {
  okStructured,
  okUntrustedStructured,
  okUntrustedLinkedStructured,
  errSwift,
  errSwiftFor,
} from "../shared/result.js";

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
      // Transcribed text + segment timings come from user-supplied audio,
      // so we mark the structured payload as untrusted. `segments` is an
      // SFSpeechRecognitionResult breakdown -- per-utterance timing/text.
      outputSchema: {
        text: z.string(),
        segments: z.array(z.unknown()),
        language: z.string(),
        onDevice: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path, language }: { path: string; language?: string }) => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = (await runSwift<{ text: string; segments: unknown[]; language: string; onDevice: boolean }>(
          "transcribe-audio",
          JSON.stringify({ path, language }),
        )) as { text: string; segments: unknown[]; language: string; onDevice: boolean };
        return okUntrustedLinkedStructured("transcribe_audio", result);
      } catch (e) {
        return errSwiftFor("transcribe audio", e);
      }
    },
  );

  server.registerTool(
    "speech_availability",
    {
      title: "Speech Recognition Status",
      description: "Check if on-device speech recognition is available and authorized.",
      inputSchema: {},
      // System capability flags only — no user-controlled content.
      outputSchema: {
        available: z.boolean(),
        supportsOnDevice: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = (await runSwift<{ available: boolean; supportsOnDevice: boolean }>(
          "speech-availability",
          "{}",
        )) as { available: boolean; supportsOnDevice: boolean };
        return okStructured(result);
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
      // Clipboard contents are user-controlled — strings, URLs, and
      // pasteboard type identifiers may come from any app or web page,
      // so we mark the structured payload as untrusted. `changeCount` is
      // an NSPasteboard counter (effectively unbounded uint64).
      outputSchema: {
        text: z.string().nullable(),
        hasImage: z.boolean(),
        hasURL: z.boolean(),
        url: z.string().nullable(),
        types: z.array(z.string()),
        changeCount: z.number().int(),
        detectedType: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = (await runSwift<{
          text: string | null;
          hasImage: boolean;
          hasURL: boolean;
          url: string | null;
          types: string[];
          changeCount: number;
          detectedType: string;
        }>("pasteboard-smart", "{}")) as {
          text: string | null;
          hasImage: boolean;
          hasURL: boolean;
          url: string | null;
          types: string[];
          changeCount: number;
          detectedType: string;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errSwiftFor("read smart clipboard", e);
      }
    },
  );
}
