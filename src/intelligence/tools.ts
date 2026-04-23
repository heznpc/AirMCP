import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, errSwift, toolError } from "../shared/result.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { zFilePath } from "../shared/validate.js";
import {
  buildPlanPrompt,
  DEFAULT_PLAN_TOOLS,
  GOLDEN_PLANS,
  parsePlanOutput,
  scorePlan,
  type PlanExpectation,
  type PlanScore,
} from "./plan-eval.js";

interface TextResult {
  output: string;
}

interface StructuredResult {
  output: string;
  valid_json: boolean;
}

interface TagResult {
  tags: Record<string, number>;
  text_preview: string;
}

interface ChatResult {
  sessionName: string;
  response: string;
}

interface AiStatusResult {
  available: boolean;
  message: string;
  macOSVersion: string;
  hasAppleSilicon: boolean;
  foundationModelsSupported: boolean;
}

interface GenerateImageResult {
  generated: boolean;
  path: string;
}

interface ScanDocumentResult {
  elements: Array<{ type: string; text: string; confidence: number }>;
  total: number;
}

export function registerIntelligenceTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "summarize_text",
    {
      title: "Summarize Text",
      description:
        "Summarize text using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon.",
      inputSchema: {
        text: z.string().max(10000).describe("Text to summarize"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ text }) => {
      try {
        const result = await runSwift<TextResult>("summarize", JSON.stringify({ text }));
        return ok(result);
      } catch (e) {
        return toolError("summarize", e);
      }
    },
  );

  server.registerTool(
    "rewrite_text",
    {
      title: "Rewrite Text",
      description:
        "Rewrite text in a specified tone using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon.",
      inputSchema: {
        text: z.string().max(10000).describe("Text to rewrite"),
        tone: z
          .enum(["professional", "friendly", "concise"])
          .optional()
          .default("professional")
          .describe("Target tone (default: professional)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text, tone }) => {
      try {
        const result = await runSwift<TextResult>("rewrite", JSON.stringify({ text, tone }));
        return ok(result);
      } catch (e) {
        return toolError("rewrite", e);
      }
    },
  );

  server.registerTool(
    "proofread_text",
    {
      title: "Proofread Text",
      description:
        "Proofread and correct grammar/spelling using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon.",
      inputSchema: {
        text: z.string().max(10000).describe("Text to proofread"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text }) => {
      try {
        const result = await runSwift<TextResult>("proofread", JSON.stringify({ text }));
        return ok(result);
      } catch (e) {
        return toolError("proofread", e);
      }
    },
  );

  // --- Foundation Models SDK tools (macOS 26+) ---

  server.registerTool(
    "generate_text",
    {
      title: "Generate Text",
      description:
        "Generate text using Apple's on-device Foundation Model with custom system instructions. Runs entirely on-device via Apple Silicon. Requires macOS 26+.",
      inputSchema: {
        prompt: z.string().max(10000).describe("The user prompt / instruction for text generation"),
        systemInstruction: z
          .string()
          .max(10000)
          .optional()
          .describe("Optional system instruction to guide the model's behavior"),
        temperature: z
          .number()
          .min(0)
          .max(2)
          .optional()
          .describe("Sampling temperature (0-2). Lower = more deterministic"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ prompt, systemInstruction, temperature }) => {
      try {
        const result = await runSwift<TextResult>(
          "generate-text",
          JSON.stringify({ prompt, systemInstruction, temperature }),
        );
        return ok(result);
      } catch (e) {
        return toolError("generate text", e);
      }
    },
  );

  server.registerTool(
    "generate_structured",
    {
      title: "Generate Structured Output",
      description:
        "Generate structured JSON output from Apple's on-device Foundation Model with optional schema constraints. Useful for extracting structured data from natural language. Requires macOS 26+.",
      inputSchema: {
        prompt: z.string().max(10000).describe("The prompt describing what structured data to generate"),
        systemInstruction: z
          .string()
          .max(10000)
          .optional()
          .describe("Optional system instruction to guide output format"),
        schema: z
          .record(
            z.object({
              type: z.string().max(1000).describe("JSON type: string, number, boolean, array, object"),
              description: z.string().max(5000).optional().describe("Description of this field"),
            }),
          )
          .optional()
          .describe("Optional JSON schema describing expected output fields"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ prompt, systemInstruction, schema }) => {
      try {
        const result = await runSwift<StructuredResult>(
          "generate-structured",
          JSON.stringify({ prompt, systemInstruction, schema }),
        );
        return ok(result);
      } catch (e) {
        return toolError("generate structured output", e);
      }
    },
  );

  server.registerTool(
    "tag_content",
    {
      title: "Tag Content",
      description:
        "Classify and tag content using Apple's on-device Foundation Model. Returns confidence scores for each provided tag/category. Requires macOS 26+.",
      inputSchema: {
        text: z.string().max(10000).describe("The text content to classify"),
        tags: z
          .array(z.string().max(200))
          .min(1)
          .max(100)
          .describe("List of tag/category names to classify the content against"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ text, tags }) => {
      try {
        const result = await runSwift<TagResult>("tag-content", JSON.stringify({ text, tags }));
        return ok(result);
      } catch (e) {
        return toolError("tag content", e);
      }
    },
  );

  server.registerTool(
    "ai_chat",
    {
      title: "AI Chat",
      description:
        "Send a message to an on-device AI session using Apple Foundation Models. Note: each call creates a fresh session — sessionName is for caller-side tracking only, not server-side persistence. Requires macOS 26+.",
      inputSchema: {
        sessionName: z
          .string()
          .max(500)
          .describe("Name for this chat session (use same name to continue a conversation)"),
        message: z.string().max(10000).describe("The message to send to the AI"),
        systemInstruction: z.string().max(10000).optional().describe("Optional system instruction for this session"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionName, message, systemInstruction }) => {
      try {
        const result = await runSwift<ChatResult>(
          "ai-chat",
          JSON.stringify({ sessionName, message, systemInstruction }),
        );
        return ok(result);
      } catch (e) {
        return toolError("chat", e);
      }
    },
  );

  // --- Image Generation (ImageCreator API, macOS 26+) ---

  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate an image from a text description using Apple Intelligence on-device image generation (Image Playground). " +
        "Returns the file path to the generated PNG. Requires macOS 26+ with Apple Silicon.",
      inputSchema: {
        prompt: z.string().min(1).max(5000).describe("Text description of the image to generate"),
        outputPath: zFilePath
          .optional()
          .refine((p) => !p || /\.(png|jpg|jpeg)$/i.test(p), "Output path must end with .png, .jpg, or .jpeg")
          .describe("Optional output path for the image (defaults to /tmp, must end in .png/.jpg)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ prompt, outputPath }) => {
      try {
        const result = await runSwift<GenerateImageResult>("generate-image", JSON.stringify({ prompt, outputPath }));
        return ok(result);
      } catch (e) {
        return toolError("generate image", e);
      }
    },
  );

  // --- Document Scanning (Vision framework, macOS 14+) ---

  server.registerTool(
    "scan_document",
    {
      title: "Scan Document",
      description:
        "Extract text and structure from an image file using Apple Vision framework OCR. " +
        "Returns recognized text elements with confidence scores. Works with photos of documents, receipts, whiteboards, etc.",
      inputSchema: {
        imagePath: zFilePath.describe("Absolute path to the image file to scan"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ imagePath }) => {
      try {
        const result = await runSwift<ScanDocumentResult>("scan-document", JSON.stringify({ imagePath }));
        return okUntrusted(result);
      } catch (e) {
        return toolError("scan document", e);
      }
    },
  );

  // --- AI Plan: on-device agent planner using Foundation Models ---

  server.registerTool(
    "generate_plan",
    {
      title: "Generate Plan",
      description:
        "Use Apple's on-device Foundation Model to analyze a goal and generate a suggested plan of AirMCP tool calls. " +
        "Returns a JSON array of planned actions for the CALLER to review and execute — this tool does NOT execute anything itself. " +
        "Requires macOS 26+. Works completely offline with no API keys.",
      inputSchema: {
        goal: z
          .string()
          .max(1000)
          .describe("What you want to accomplish (e.g. 'organize my day', 'prepare for meeting')"),
        context: z
          .string()
          .max(10000)
          .optional()
          .describe("Additional context (max 10K chars, e.g. snapshot text, recent events)"),
        availableTools: z
          .array(z.string())
          .optional()
          .describe("List of available tool names to plan with. Defaults to common tools."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ goal, context, availableTools }) => {
      try {
        const tools = availableTools ?? [...DEFAULT_PLAN_TOOLS];
        const prompt = buildPlanPrompt(goal, context, tools);

        const result = await runSwift<StructuredResult>(
          "generate-structured",
          JSON.stringify({
            prompt,
            systemInstruction:
              "You are an action planner. Analyze the goal and available tools, then output a JSON array of steps to achieve the goal. Be practical and concise.",
          }),
        );
        return ok({
          plan: result.output,
          valid_json: result.valid_json,
          model: "apple-foundation-models",
          warning: "Plan generated by on-device model — review before executing.",
        });
      } catch (e) {
        return toolError("generate plan", e);
      }
    },
  );

  // --- Plan accuracy metrics ---
  //
  // `ai_plan_metrics` runs a batch of GOLDEN_PLANS cases against the live
  // on-device planner and aggregates the scores. Users can call it after
  // a macOS update / Foundation Models refresh to see whether planner
  // quality regressed. It's intentionally built on the same scoring
  // primitives that `tests/plan-eval.test.js` uses in CI — same math,
  // real model instead of fixtures.
  server.registerTool(
    "ai_plan_metrics",
    {
      title: "AI Plan Metrics",
      description:
        "Run a sample of planner goals against the on-device Foundation Model and report the aggregate score. " +
        "Useful after macOS / Apple Intelligence updates to catch planner regressions. Requires macOS 26+ " +
        "with Apple Silicon. Each case makes one model call, so keep `limit` small for interactive use.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(5)
          .describe("Number of cases to sample from GOLDEN_PLANS (default: 5, max: 50)."),
        seed: z
          .number()
          .int()
          .optional()
          .describe(
            "Deterministic seed for case selection (default: time-based). Fixing this is useful when comparing runs before/after a change.",
          ),
      },
      outputSchema: {
        sampled: z.number(),
        averageScore: z.number(),
        parseRate: z.number(),
        expectedCoverageAvg: z.number(),
        leakedForbiddenTotal: z.number(),
        perCase: z.array(
          z.object({
            name: z.string(),
            total: z.number(),
            matchedExpected: z.array(z.string()),
            leakedForbidden: z.array(z.string()),
            stepCount: z.number(),
            unknownTools: z.array(z.string()),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ limit, seed }) => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);

      try {
        const cases = sampleCases(GOLDEN_PLANS, limit ?? 5, seed);
        const results: Array<{ expectation: PlanExpectation; score: PlanScore }> = [];

        for (const expectation of cases) {
          const prompt = buildPlanPrompt(expectation.goal, expectation.context, DEFAULT_PLAN_TOOLS);
          let raw = "";
          try {
            const result = await runSwift<StructuredResult>(
              "generate-structured",
              JSON.stringify({
                prompt,
                systemInstruction:
                  "You are an action planner. Analyze the goal and available tools, then output a JSON array of steps to achieve the goal. Be practical and concise.",
              }),
            );
            raw = result.output ?? "";
          } catch {
            // Swift/model failure leaves raw="", which scorePlan treats as
            // a zero-score unparseable result. We record it and move on so
            // a flaky single case doesn't sink the whole batch.
          }
          const plan = parsePlanOutput(raw);
          const score = scorePlan(plan, expectation, DEFAULT_PLAN_TOOLS);
          results.push({ expectation, score });
        }

        const sampled = results.length;
        const totals = results.map((r) => r.score.total);
        const averageScore = sampled > 0 ? +(totals.reduce((a, b) => a + b, 0) / sampled).toFixed(2) : 0;
        const parseRate =
          sampled > 0 ? +(results.filter((r) => r.score.parts.parseable > 0).length / sampled).toFixed(4) : 0;
        const expectedCoverageAvg =
          sampled > 0 ? +(results.reduce((sum, r) => sum + r.score.parts.expectedCoverage, 0) / sampled).toFixed(2) : 0;
        const leakedForbiddenTotal = results.reduce((sum, r) => sum + r.score.leakedForbidden.length, 0);

        return ok({
          sampled,
          averageScore,
          parseRate,
          expectedCoverageAvg,
          leakedForbiddenTotal,
          perCase: results.map((r) => ({
            name: r.expectation.name,
            total: r.score.total,
            matchedExpected: r.score.matchedExpected,
            leakedForbidden: r.score.leakedForbidden,
            stepCount: r.score.validation.stepCount,
            unknownTools: r.score.validation.unknownTools,
          })),
        });
      } catch (e) {
        return toolError("ai plan metrics", e);
      }
    },
  );

  // --- AI Status ---

  server.registerTool(
    "ai_status",
    {
      title: "AI Status",
      description:
        "Check availability and status of Apple's on-device Foundation Models. Returns whether the model is available, macOS version, and Apple Silicon status.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await runSwift<AiStatusResult>("ai-status", "{}");
        return ok(result);
      } catch (e) {
        return toolError("check AI status", e);
      }
    },
  );

  // --- On-Device AI Agent: Foundation Models + AirMCP tools ---

  server.registerTool(
    "ai_agent",
    {
      title: "On-Device AI Agent",
      description:
        "Run a prompt through Apple's on-device Foundation Models with access to AirMCP tools (Calendar, Reminders, Contacts). " +
        "The on-device LLM autonomously decides which tools to call. Requires macOS 26+ with Apple Silicon.",
      inputSchema: {
        prompt: z.string().min(1).max(10000).describe("What you want the on-device AI to do with your Apple data"),
        systemInstruction: z.string().max(10000).optional().describe("Optional system instruction for the AI agent"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ prompt, systemInstruction }) => {
      const bridgeErr = await checkSwiftBridge();
      if (bridgeErr) return errSwift(`Swift bridge required: ${bridgeErr}`);
      try {
        const result = await runSwift<TextResult>(
          "ai-agent",
          JSON.stringify({ text: prompt, tone: systemInstruction }),
        );
        return ok({ response: result.output, model: "apple-foundation-models", onDevice: true });
      } catch (e) {
        return toolError("run on-device AI agent", e);
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Seedable LCG — gives `ai_plan_metrics` reproducible case selection
 *  when the caller provides a seed, so runs before/after a change can
 *  be compared on the exact same slice of GOLDEN_PLANS. */
function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Fisher–Yates sample of `limit` items from `pool`, reproducible when
 *  `seed` is provided. Returns a fresh array so the caller can iterate
 *  without worrying about shared state. */
function sampleCases<T>(pool: readonly T[], limit: number, seed?: number): T[] {
  const arr = [...pool];
  const rng = lcg(seed ?? Date.now());
  // Shuffle in-place, then slice. For small `limit` vs large `pool`
  // this is overkill but the pool size is bounded (<100) so readability
  // wins over a partial Fisher–Yates optimisation.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i]!, arr[j]!] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.min(limit, arr.length));
}
