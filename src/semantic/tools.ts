import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import {
  okStructured,
  okUntrustedStructured,
  errNotFound,
  errUpstream,
  errSwift,
  toolError,
} from "../shared/result.js";
import type { AirMcpConfig } from "../shared/config.js";
import { SemanticSearchService } from "./service.js";
import { runSwift, checkSwiftBridge } from "../shared/swift.js";

/**
 * Semantic search tools -- on-device NLContextualEmbedding via Swift bridge
 * or Gemini embedding API.
 *
 * All mutable state (provider cache, indexing lock, vector store) lives in
 * SemanticSearchService; this module is a thin MCP registration layer.
 */

// Per-entry stats shape returned by VectorStore.getStats(). Used inside
// semantic_index (under `store`) and semantic_status (flattened in).
const indexStatsShape = {
  total: z.number().int(),
  bySource: z.record(z.string(), z.number().int()),
  indexedAt: z.string().nullable(),
  stale: z.boolean(),
};

// One search hit returned by VectorStore.search(). Title is derived from
// user-controlled note/event/reminder/email metadata, so any structured
// payload containing this shape is marked untrusted via the helper.
const searchResultSchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  similarity: z.number(),
});

export function registerSemanticTools(server: McpServer, config: AirMcpConfig): void {
  const service = new SemanticSearchService(config);

  // -- Index: build/rebuild the vector store from Apple app data --
  server.registerTool(
    "semantic_index",
    {
      title: "Build Semantic Index",
      description:
        "Index data from enabled Apple apps (Notes, Calendar, Reminders, Mail, Photos, Finder) into the local " +
        "vector store for semantic search. Run this once, then use semantic_search. Replaces any existing " +
        "index. Requires Swift bridge (npm run swift-build).",
      inputSchema: {
        sources: z
          .array(z.enum(["notes", "calendar", "reminders", "mail", "photos", "finder"]))
          .optional()
          .describe("Which sources to index. Defaults to all enabled modules."),
      },
      // System-generated counters; `warnings` is only present when one or
      // more sources hit a partial-failure path (e.g. Mail permission
      // denied while Notes succeeds).
      outputSchema: {
        indexed: z.number().int(),
        store: z.object(indexStatsShape),
        warnings: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ sources }, extra) => {
      try {
        const progressToken = extra._meta?.progressToken;
        const onProgress =
          progressToken !== undefined
            ? async (progress: number, total: number, message: string) => {
                await extra.sendNotification({
                  method: "notifications/progress",
                  params: { progressToken, progress, total, message },
                });
              }
            : undefined;

        const { indexed, errors, store } = await service.index(sources, onProgress);
        if (indexed === 0) {
          return errUpstream(`No items to index.${errors.length > 0 ? " Errors: " + errors.join("; ") : ""}`);
        }
        return okStructured({
          indexed,
          store,
          ...(errors.length > 0 ? { warnings: errors } : {}),
        });
      } catch (e) {
        return toolError("index", e);
      }
    },
  );

  // -- Search: semantic search across indexed data --
  server.registerTool(
    "semantic_search",
    {
      title: "Semantic Search",
      description:
        "Search across Apple app data by meaning, not just keywords. " +
        "Finds related notes, events, reminders, and emails even if they use different words. " +
        "Auto-indexes on first use and refreshes every 30 minutes.",
      inputSchema: {
        query: z.string().max(500).describe("Natural language search query"),
        sources: z
          .array(z.enum(["notes", "calendar", "reminders", "mail"]))
          .optional()
          .describe("Filter by source type"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        threshold: z.number().min(0).max(1).optional().describe("Minimum similarity (default 0.5)"),
      },
      // Results derive titles from user-controlled note/event/reminder/
      // email content, and we echo the caller's query verbatim — both
      // make this untrusted from the LLM's perspective.
      outputSchema: {
        query: z.string(),
        results: z.array(searchResultSchema),
        total: z.number().int(),
        autoIndexed: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, sources, limit, threshold }) => {
      try {
        const result = (await service.search(query, { sources, limit, threshold })) as {
          query: string;
          results: Array<{ id: string; source: string; title: string; similarity: number }>;
          total: number;
          autoIndexed: boolean;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("semantic search", e);
      }
    },
  );

  // -- Find Related: given an item, find semantically related items --
  server.registerTool(
    "find_related",
    {
      title: "Find Related Items",
      description:
        "Given a note, event, reminder, or email ID, find semantically related items across all indexed Apple apps. " +
        "Discovers cross-app connections (e.g., a calendar event related to notes and reminders about the same topic).",
      inputSchema: {
        id: z.string().max(500).describe("Item ID (as stored in the vector index)"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        threshold: z.number().min(0).max(1).optional().describe("Minimum similarity (default 0.6)"),
      },
      // Seed item title and every related hit's title come from indexed
      // user content, so the structured payload is untrusted.
      outputSchema: {
        item: z.object({
          id: z.string(),
          source: z.string(),
          title: z.string(),
        }),
        related: z.array(searchResultSchema),
        total: z.number().int(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, limit, threshold }) => {
      try {
        const result = (await service.findRelated(id, { limit, threshold })) as {
          item: { id: string; source: string; title: string };
          related: Array<{ id: string; source: string; title: string; similarity: number }>;
          total: number;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("semantic search", e);
      }
    },
  );

  // -- Spotlight: push indexed data to macOS Spotlight for Siri discovery --
  server.registerTool(
    "spotlight_sync",
    {
      title: "Sync to Spotlight",
      description:
        "Push semantically indexed data to macOS Core Spotlight, making it discoverable via Spotlight search and Siri. " +
        "Run after semantic_index to expose your notes, events, reminders, and emails to system-wide search. " +
        "Requires Swift bridge (npm run swift-build).",
      inputSchema: {},
      // System ack from the Swift bridge — fixed shape, no user content.
      outputSchema: {
        indexed: z.number().int(),
        success: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const swiftErr = await checkSwiftBridge();
        if (swiftErr) return errSwift(swiftErr);

        const stats = await service.status();
        if (stats.total === 0) {
          return errNotFound("No indexed data. Run semantic_index first.");
        }

        // Get all entries from the store and push to Spotlight
        const store = await service.getStoreData();
        const items = Object.values(store).map((entry) => ({
          id: entry.id,
          title: entry.title,
          content: entry.text,
          source: entry.source,
        }));

        const result = (await runSwift<{ indexed: number; success: boolean }>(
          "spotlight-index",
          JSON.stringify({ items }),
        )) as { indexed: number; success: boolean };
        return okStructured(result);
      } catch (e) {
        return toolError("spotlight sync", e);
      }
    },
  );

  // -- Clear: delete all vector store data + Spotlight entries --
  server.registerTool(
    "semantic_clear",
    {
      title: "Clear Semantic Index",
      description:
        "Delete all indexed data from the local vector store AND remove corresponding entries from macOS Spotlight. " +
        "Use for privacy or to force a fresh re-index. Requires Swift bridge for Spotlight cleanup.",
      inputSchema: {},
      // System ack — entry count cleared plus whether the optional
      // Spotlight purge ran (it's best-effort if the Swift bridge is
      // unavailable).
      outputSchema: {
        cleared: z.number().int(),
        spotlightCleared: z.boolean(),
        message: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const before = await service.status();
        await service.clear();
        // Also clear Spotlight entries if Swift bridge is available
        const swiftErr = await checkSwiftBridge();
        if (!swiftErr) {
          try {
            await runSwift("spotlight-clear", "{}");
          } catch {
            // Spotlight clear is best-effort
          }
        }
        return okStructured({
          cleared: before.total,
          spotlightCleared: !swiftErr,
          message: "Vector store and Spotlight index cleared.",
        });
      } catch (e) {
        return toolError("clear index", e);
      }
    },
  );

  // -- Spotlight Clear: remove only Spotlight entries (keep vector store) --
  server.registerTool(
    "spotlight_clear",
    {
      title: "Clear Spotlight Index",
      description:
        "Remove all AirMCP entries from macOS Spotlight without clearing the local vector store. Requires Swift bridge.",
      inputSchema: {},
      // System ack from the Swift bridge.
      outputSchema: {
        cleared: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const swiftErr = await checkSwiftBridge();
        if (swiftErr) return errSwift(swiftErr);
        const result = (await runSwift<{ cleared: boolean }>("spotlight-clear", "{}")) as { cleared: boolean };
        return okStructured(result);
      } catch (e) {
        return toolError("spotlight clear", e);
      }
    },
  );

  // -- Stats: vector store status --
  server.registerTool(
    "semantic_status",
    {
      title: "Semantic Index Status",
      description: "Show the current state of the semantic vector index -- total entries, breakdown by source.",
      inputSchema: {},
      // Index health snapshot — system-derived counters and capability
      // flags. Shares `indexStatsShape` with semantic_index's `store`
      // sub-object plus two backend-availability fields.
      outputSchema: {
        embeddingAvailable: z.boolean(),
        provider: z.string(),
        ...indexStatsShape,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status = (await service.status()) as {
          embeddingAvailable: boolean;
          provider: string;
          total: number;
          bySource: Record<string, number>;
          indexedAt: string | null;
          stale: boolean;
        };
        return okStructured(status);
      } catch (e) {
        return toolError("check semantic status", e);
      }
    },
  );
}
