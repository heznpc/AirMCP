import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { API, MODELS, TIMEOUT, LIMITS } from "../shared/constants.js";

interface EmbedTextResult {
  vector: number[];
  dimension: number;
}

interface EmbedBatchResult {
  vectors: number[][];
  dimension: number;
  count: number;
}

// -- Gemini Embedding API types --

interface GeminiEmbedResponse {
  embedding: { values: number[] };
}

interface GeminiBatchEmbedResponse {
  embeddings: Array<{ values: number[] }>;
}

// -- Provider detection --

export type EmbeddingProvider = "gemini" | "swift" | "hybrid" | "none";

// Derived from centralized constants
const GEMINI_MODEL = MODELS.GEMINI_EMBEDDING;
const GEMINI_DIMENSION = MODELS.EMBEDDING_DIM;
const GEMINI_EMBED_URL = `${API.GEMINI_BASE}/${GEMINI_MODEL}:embedContent`;
const GEMINI_BATCH_URL = `${API.GEMINI_BASE}/${GEMINI_MODEL}:batchEmbedContents`;

/**
 * Detect which embedding provider is available.
 *
 * Priority:
 *   1. AIRMCP_EMBEDDING_PROVIDER env var (explicit override)
 *   2. "hybrid" if both GEMINI_API_KEY and Swift bridge are available
 *   3. "gemini" if GEMINI_API_KEY is set
 *   4. "swift" if Swift bridge is available
 *   5. "none"
 */
export async function detectProvider(): Promise<EmbeddingProvider> {
  const explicit = process.env.AIRMCP_EMBEDDING_PROVIDER as EmbeddingProvider | undefined;
  if (explicit && ["gemini", "swift", "hybrid", "none"].includes(explicit)) {
    return explicit;
  }

  const hasGemini = !!process.env.GEMINI_API_KEY;
  const swiftErr = await checkSwiftBridge();
  const hasSwift = swiftErr === null;

  if (hasGemini && hasSwift) return "hybrid";
  if (hasGemini) return "gemini";
  if (hasSwift) return "swift";
  return "none";
}

// -- Gemini Embedding API --

async function geminiEmbed(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const res = await fetch(GEMINI_EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: GEMINI_DIMENSION,
    }),
    signal: AbortSignal.timeout(TIMEOUT.EMBED_SINGLE),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiEmbedResponse;
  return data.embedding.values;
}

async function geminiBatchEmbed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY!;

  // Gemini batch API: max 100 per request
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += LIMITS.EMBED_BATCH_SIZE) {
    chunks.push(texts.slice(i, i + LIMITS.EMBED_BATCH_SIZE));
  }

  const allVectors: number[][] = [];

  for (const chunk of chunks) {
    const res = await fetch(GEMINI_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        requests: chunk.map((text) => ({
          model: `models/${GEMINI_MODEL}`,
          content: { parts: [{ text }] },
          taskType: "SEMANTIC_SIMILARITY",
          outputDimensionality: GEMINI_DIMENSION,
        })),
      }),
      signal: AbortSignal.timeout(TIMEOUT.EMBED_BATCH),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini batch API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as GeminiBatchEmbedResponse;
    allVectors.push(...data.embeddings.map((e) => e.values));
  }

  return allVectors;
}

// -- Swift bridge embedding --

async function swiftEmbed(text: string, language?: string): Promise<number[]> {
  const result = await runSwift<EmbedTextResult>(
    "embed-text",
    JSON.stringify({ text, language }),
  );
  return result.vector;
}

async function swiftBatchEmbed(texts: string[], language?: string): Promise<number[][]> {
  const result = await runSwift<EmbedBatchResult>(
    "embed-batch",
    JSON.stringify({ texts, language }),
  );
  return result.vectors;
}

// -- Hybrid: on-device first, cloud fallback --

async function hybridEmbed(text: string, language?: string): Promise<number[]> {
  try {
    return await swiftEmbed(text, language);
  } catch {
    // Swift bridge failed — fallback to Gemini cloud
    return geminiEmbed(text);
  }
}

async function hybridBatchEmbed(texts: string[], language?: string): Promise<number[][]> {
  try {
    return await swiftBatchEmbed(texts, language);
  } catch {
    return geminiBatchEmbed(texts);
  }
}

// -- Public API (auto-selects provider) --

/** Embed a single text. Provider priority: hybrid > gemini > swift > error. */
export async function embedText(text: string, provider: EmbeddingProvider, language?: string): Promise<number[]> {
  switch (provider) {
    case "gemini":  return geminiEmbed(text);
    case "swift":   return swiftEmbed(text, language);
    case "hybrid":  return hybridEmbed(text, language);
    default:
      throw new Error("No embedding backend available. Set GEMINI_API_KEY or run 'npm run swift-build'.");
  }
}

/** Embed multiple texts. Provider priority: hybrid > gemini > swift > error. */
export async function embedBatch(texts: string[], provider: EmbeddingProvider, language?: string): Promise<number[][]> {
  switch (provider) {
    case "gemini":  return geminiBatchEmbed(texts);
    case "swift":   return swiftBatchEmbed(texts, language);
    case "hybrid":  return hybridBatchEmbed(texts, language);
    default:
      throw new Error("No embedding backend available. Set GEMINI_API_KEY or run 'npm run swift-build'.");
  }
}

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Get current embedding config for diagnostics. */
export function getEmbeddingConfig() {
  return {
    model: GEMINI_MODEL,
    dimension: GEMINI_DIMENSION,
    hasApiKey: !!process.env.GEMINI_API_KEY,
    explicitProvider: process.env.AIRMCP_EMBEDDING_PROVIDER || null,
  };
}
