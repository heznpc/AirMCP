import {
  embedText,
  embedBatch,
  cosineSimilarity,
  detectProvider,
  type EmbeddingProvider,
} from "../semantic/embeddings.js";
import { toolRegistry, type ToolInfo } from "./tool-registry.js";
import { LIMITS } from "./constants.js";

interface ToolVector {
  name: string;
  title?: string;
  description?: string;
  vector: number[];
}

let toolVectors: ToolVector[] = [];
let provider: EmbeddingProvider = "none";
let indexed = false;

/** Build the tool description vector index. Call once after all tools are registered. */
export async function indexToolDescriptions(): Promise<number> {
  provider = await detectProvider();
  if (provider === "none") return 0;

  const tools = toolRegistry
    .getToolNames()
    .map((name) => toolRegistry.getToolInfo(name))
    .filter((t): t is ToolInfo => t !== undefined);
  const texts = tools.map((t) => `${t.name}: ${t.title ?? ""} ${t.description ?? ""}`);

  try {
    const vectors = await embedBatch(texts, provider);
    toolVectors = [];
    for (let i = 0; i < tools.length; i++) {
      const vec = vectors[i];
      if (!vec) continue;
      const t = tools[i]!;
      toolVectors.push({ name: t.name, title: t.title, description: t.description, vector: vec });
    }
    indexed = true;
    return toolVectors.length;
  } catch {
    return 0;
  }
}

/** Search tools by semantic similarity. Returns top matches above threshold. */
export async function semanticToolSearch(
  query: string,
  limit = 10,
  threshold = LIMITS.SEARCH_THRESHOLD,
): Promise<ToolInfo[]> {
  if (!indexed || provider === "none") return [];

  try {
    const queryVector = await embedText(query, provider);
    const scored = toolVectors
      .map((tv) => ({
        info: { name: tv.name, title: tv.title, description: tv.description } as ToolInfo,
        score: cosineSimilarity(queryVector, tv.vector),
      }))
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.info);
  } catch {
    return [];
  }
}

/** Check if semantic tool search is available. */
export function isToolSearchIndexed(): boolean {
  return indexed;
}
