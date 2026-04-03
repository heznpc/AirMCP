import { createHash } from "node:crypto";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";
import { API, MODELS, TIMEOUT, LIMITS } from "../shared/constants.js";
import { TtlCache } from "../shared/cache.js";

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

// -- Embedding cache (tool descriptions + repeated queries are immutable per session) --
const embedCache = new TtlCache({
  maxEntries: 1000,
  autoPruneMs: 10 * 60_000,
  maxMemoryBytes: LIMITS.EMBED_CACHE_MAX_MB * 1024 * 1024,
});
const EMBED_CACHE_TTL = 60 * 60_000; // 60 minutes — tool descriptions and note titles are quasi-static

/** Hash text for cache key — avoids storing PII/secrets in plaintext cache keys. */
function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function embedCacheKey(provider: EmbeddingProvider, language: string | undefined, text: string): string {
  return `embed:${provider}:${language ?? ""}:${hashText(text)}`;
}

const NO_BACKEND_ERROR = "No embedding backend available. Set GEMINI_API_KEY or run 'npm run swift-build'.";

// -- Max concurrent batch chunks to Gemini API --
const BATCH_CONCURRENCY = 3;

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
    throw new Error(`Gemini API error ${res.status}: ${redactApiResponse(body)}`);
  }

  const data = (await res.json()) as GeminiEmbedResponse;
  return data.embedding.values;
}

/** Redact sensitive data from API error responses. */
function redactApiResponse(body: string): string {
  return body
    .slice(0, 200)
    .replace(/key=[^&\s]*/gi, "key=[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[^\s"]+/gi, "Bearer [REDACTED]");
}

async function geminiBatchEmbedChunk(chunk: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY!;
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
    throw new Error(`Gemini batch API error ${res.status}: ${redactApiResponse(body)}`);
  }

  const data = (await res.json()) as GeminiBatchEmbedResponse;
  return data.embeddings.map((e) => e.values);
}

async function geminiBatchEmbed(texts: string[]): Promise<number[][]> {
  // Gemini batch API: max 100 per request
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += LIMITS.EMBED_BATCH_SIZE) {
    chunks.push(texts.slice(i, i + LIMITS.EMBED_BATCH_SIZE));
  }

  // Process chunks in parallel (up to BATCH_CONCURRENCY at a time)
  const allVectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH_CONCURRENCY) {
    const batch = chunks.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(batch.map((chunk) => geminiBatchEmbedChunk(chunk)));
    for (const vectors of results) {
      allVectors.push(...vectors);
    }
  }

  return allVectors;
}

// -- Swift bridge embedding --

async function swiftEmbed(text: string, language?: string): Promise<number[]> {
  const result = await runSwift<EmbedTextResult>("embed-text", JSON.stringify({ text, language }));
  return result.vector;
}

async function swiftBatchEmbed(texts: string[], language?: string): Promise<number[][]> {
  const result = await runSwift<EmbedBatchResult>("embed-batch", JSON.stringify({ texts, language }));
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

/** Embed a single text. Cached for 60 min — repeated queries skip API calls. */
export async function embedText(text: string, provider: EmbeddingProvider, language?: string): Promise<number[]> {
  const cacheKey = embedCacheKey(provider, language, text);
  return embedCache.getOrSet<number[]>(cacheKey, EMBED_CACHE_TTL, async () => {
    switch (provider) {
      case "gemini":
        return geminiEmbed(text);
      case "swift":
        return swiftEmbed(text, language);
      case "hybrid":
        return hybridEmbed(text, language);
      default:
        throw new Error(NO_BACKEND_ERROR);
    }
  });
}

/** Embed multiple texts with per-text cache. Only uncached texts hit the API. */
export async function embedBatch(texts: string[], provider: EmbeddingProvider, language?: string): Promise<number[][]> {
  // Precompute cache keys to avoid double-hashing
  const cacheKeys = texts.map((text) => embedCacheKey(provider, language, text));
  const results: (number[] | null)[] = cacheKeys.map((key) => embedCache.get<number[]>(key) ?? null);

  const uncachedIdx = results.reduce<number[]>((acc, r, i) => {
    if (r === null) acc.push(i);
    return acc;
  }, []);

  if (uncachedIdx.length === 0) return results as number[][];

  // Batch-embed only uncached texts
  const uncachedTexts = uncachedIdx.map((i) => texts[i]!);
  let newVectors: number[][];
  switch (provider) {
    case "gemini":
      newVectors = await geminiBatchEmbed(uncachedTexts);
      break;
    case "swift":
      newVectors = await swiftBatchEmbed(uncachedTexts, language);
      break;
    case "hybrid":
      newVectors = await hybridBatchEmbed(uncachedTexts, language);
      break;
    default:
      throw new Error(NO_BACKEND_ERROR);
  }

  // Cache new vectors and merge into results
  for (let j = 0; j < uncachedIdx.length; j++) {
    const idx = uncachedIdx[j]!;
    const vector = newVectors[j]!;
    embedCache.set(cacheKeys[idx]!, vector, EMBED_CACHE_TTL);
    results[idx] = vector;
  }

  return results as number[][];
}

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
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
