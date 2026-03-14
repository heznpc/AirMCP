import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, err, toolError } from "../shared/result.js";
import { AirMcpConfig } from "../shared/config.js";
import { SemanticSearchService } from "./service.js";

/**
 * Semantic search tools -- on-device NLContextualEmbedding via Swift bridge
 * or Gemini embedding API.
 *
 * All mutable state (provider cache, indexing lock, vector store) lives in
 * SemanticSearchService; this module is a thin MCP registration layer.
 */
export function registerSemanticTools(server: McpServer, config: AirMcpConfig): void {
  const service = new SemanticSearchService(config);

  // -- Index: build/rebuild the vector store from Apple app data --
  server.registerTool(
    "semantic_index",
    {
      title: "Build Semantic Index",
      description:
        "Index data from enabled Apple apps (Notes, Calendar, Reminders, Mail) into the local vector store " +
        "for semantic search. Run this once, then use semantic_search. Requires Swift bridge (npm run swift-build).",
      inputSchema: {
        sources: z
          .array(z.enum(["notes", "calendar", "reminders", "mail"]))
          .optional()
          .describe("Which sources to index. Defaults to all enabled modules."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sources }) => {
      try {
        const { indexed, errors, store } = await service.index(sources);
        if (indexed === 0) {
          return err(`No items to index.${errors.length > 0 ? " Errors: " + errors.join("; ") : ""}`);
        }
        return ok({
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
        query: z.string().describe("Natural language search query"),
        sources: z
          .array(z.enum(["notes", "calendar", "reminders", "mail"]))
          .optional()
          .describe("Filter by source type"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        threshold: z.number().min(0).max(1).optional().describe("Minimum similarity (default 0.5)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, sources, limit, threshold }) => {
      try {
        const result = await service.search(query, { sources, limit, threshold });
        return ok(result);
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
        id: z.string().describe("Item ID (as stored in the vector index)"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        threshold: z.number().min(0).max(1).optional().describe("Minimum similarity (default 0.6)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, limit, threshold }) => {
      try {
        const result = await service.findRelated(id, { limit, threshold });
        return ok(result);
      } catch (e) {
        return toolError("semantic search", e);
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status = await service.status();
        return ok(status);
      } catch (e) {
        return toolError("semantic search", e);
      }
    },
  );
}
