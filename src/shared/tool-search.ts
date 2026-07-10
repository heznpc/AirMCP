import {
  embedText,
  embedBatch,
  cosineSimilarity,
  detectProvider,
  type EmbeddingProvider,
} from "../semantic/embeddings.js";
import { toolRegistry, type ToolInfo, type ToolRegistry } from "./tool-registry.js";
import { LIMITS } from "./constants.js";

interface ToolVector {
  name: string;
  title?: string;
  description?: string;
  vector: number[];
}

interface ToolSearchIndex {
  toolVectors: ToolVector[];
  provider: EmbeddingProvider;
  indexed: boolean;
}

const indexes = new WeakMap<ToolRegistry, ToolSearchIndex>();

function getIndex(registry: ToolRegistry): ToolSearchIndex {
  let index = indexes.get(registry);
  if (!index) {
    index = { toolVectors: [], provider: "none", indexed: false };
    indexes.set(registry, index);
  }
  return index;
}

/** Build the tool description vector index. Call once after all tools are registered. */
export async function indexToolDescriptions(registry: ToolRegistry = toolRegistry): Promise<number> {
  const index = getIndex(registry);
  index.provider = await detectProvider();
  if (index.provider === "none") return 0;

  const tools = registry
    .getToolNames()
    .map((name) => registry.getToolInfo(name, { descriptionMode: "full" }))
    .filter((t): t is ToolInfo => t !== undefined);
  const texts = tools.map((t) => `${t.name}: ${t.title ?? ""} ${t.description ?? ""}`);

  try {
    const vectors = await embedBatch(texts, index.provider);
    index.toolVectors = [];
    for (let i = 0; i < tools.length; i++) {
      const vec = vectors[i];
      if (!vec) continue;
      const t = tools[i]!;
      index.toolVectors.push({ name: t.name, title: t.title, description: t.description, vector: vec });
    }
    index.indexed = true;
    return index.toolVectors.length;
  } catch {
    return 0;
  }
}

/** Search tools by semantic similarity. Returns top matches above threshold. */
export async function semanticToolSearch(
  query: string,
  limit = 10,
  threshold = LIMITS.SEARCH_THRESHOLD,
  registry: ToolRegistry = toolRegistry,
): Promise<ToolInfo[]> {
  const index = getIndex(registry);
  if (!index.indexed || index.provider === "none") return [];

  try {
    const queryVector = await embedText(query, index.provider);
    const scored = index.toolVectors
      .map((tv) => ({
        info:
          registry.getToolInfo(tv.name, { descriptionMode: "summary" }) ??
          ({ name: tv.name, title: tv.title, description: tv.description } as ToolInfo),
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
export function isToolSearchIndexed(registry: ToolRegistry = toolRegistry): boolean {
  return getIndex(registry).indexed;
}
