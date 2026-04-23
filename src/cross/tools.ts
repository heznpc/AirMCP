import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { ok, errInvalidInput, errUpstream, toolError, toolErr } from "../shared/result.js";
import { buildSnapshot } from "../shared/resources.js";
import type { AirMcpConfig } from "../shared/config.js";
import { isModuleEnabled } from "../shared/config.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { checkOllama, ollamaGenerate, ollamaModels, DEFAULT_MODEL } from "../shared/local-llm.js";

/**
 * Cross-module tools that leverage MCP Sampling to delegate
 * intelligence to the client's LLM — no API keys needed.
 */
export function registerCrossTools(mcpServer: McpServer, config: AirMcpConfig): void {
  const lowServer = mcpServer.server;
  const enabled = (mod: string) => isModuleEnabled(config, mod);

  mcpServer.registerTool(
    "summarize_context",
    {
      title: "Summarize Context",
      description:
        "Collect context from all enabled Apple apps and ask the client's LLM to produce a concise briefing. " +
        "Uses MCP Sampling — works with any LLM the client is using. No API keys required.",
      inputSchema: {
        focus: z
          .string()
          .max(500)
          .optional()
          .describe("Optional focus area (e.g. 'meetings', 'overdue tasks', 'project X')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ focus }) => {
      // 1. Build context snapshot directly
      let snapshotText: string;
      try {
        snapshotText = await buildSnapshot(enabled, "standard");
      } catch (e) {
        return toolErr(
          "internal_error",
          `Failed to build context snapshot: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (!snapshotText || snapshotText === "{}") {
        return errInvalidInput("Context snapshot is empty. Are any modules enabled?");
      }

      // 2. Use MCP Sampling to ask the client's LLM for a summary
      const systemPrompt = [
        "You are a personal assistant summarizing a user's Apple ecosystem context.",
        "Be concise and actionable. Prioritize time-sensitive items.",
        "Format: short paragraphs, no bullet points exceeding 5 items.",
        focus ? `Focus especially on: ${focus}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      try {
        const result = await lowServer.createMessage({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Here is my current Apple ecosystem context:\n\n${snapshotText}\n\nPlease give me a concise briefing of what I need to know right now.`,
              },
            },
          ],
          systemPrompt,
          maxTokens: 500,
          modelPreferences: {
            speedPriority: 0.8,
            intelligencePriority: 0.5,
            costPriority: 0.8,
          },
        });

        const text = result.content.type === "text" ? result.content.text : JSON.stringify(result.content);

        return ok({ briefing: text, model: result.model });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not supported") || msg.includes("sampling") || msg.includes("Method not found")) {
          // Fallback: try on-device Foundation Models
          const swiftErr = await checkSwiftBridge();
          if (!swiftErr) {
            try {
              const fmResult = await runSwift<{ output: string }>(
                "generate-text",
                JSON.stringify({
                  prompt: `Summarize this context concisely and actionably:\n\n${snapshotText}`,
                  systemInstruction: "You are a personal assistant. Be concise. Prioritize time-sensitive items.",
                }),
              );
              return ok({ briefing: fmResult.output, model: "apple-foundation-models", fallback: true });
            } catch (fmErr) {
              console.error(`[AirMCP] FM fallback failed: ${fmErr instanceof Error ? fmErr.message : String(fmErr)}`);
            }
          }
          let snapshot: unknown;
          try {
            snapshot = JSON.parse(snapshotText);
          } catch {
            snapshot = snapshotText;
          }
          return ok({
            briefing: null,
            fallback: "Client does not support MCP Sampling and Foundation Models unavailable. Returning raw snapshot.",
            snapshot,
          });
        }
        return errUpstream(`Sampling failed: ${msg}`);
      }
    },
  );

  mcpServer.registerTool(
    "local_llm_generate",
    {
      title: "Local LLM Generate",
      description:
        "Generate text using a local Ollama model. Runs entirely on your machine — no data sent to any cloud. " +
        "Requires Ollama running at localhost:11434. Useful for summarization, extraction, and analysis.",
      inputSchema: {
        prompt: z.string().min(1).max(10000).describe("The prompt to send to the local LLM"),
        model: z.string().max(500).optional().describe("Ollama model name (default: llama3.2)"),
        system: z.string().max(10000).optional().describe("System instruction for the model"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, model, system }) => {
      const available = await checkOllama();
      if (!available)
        return errUpstream("Ollama is not running. Start it with 'ollama serve' or install from ollama.com");
      try {
        const response = await ollamaGenerate(prompt, { model, system });
        return ok({ response, model: model ?? DEFAULT_MODEL, local: true });
      } catch (e) {
        return toolError("generate with local LLM", e);
      }
    },
  );

  mcpServer.registerTool(
    "local_llm_status",
    {
      title: "Local LLM Status",
      description: "Check if a local Ollama LLM is available and list installed models.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      const available = await checkOllama();
      if (!available)
        return ok({ available: false, models: [], hint: "Install Ollama from ollama.com and run 'ollama serve'" });
      const models = await ollamaModels();
      return ok({ available: true, models });
    },
  );
}
