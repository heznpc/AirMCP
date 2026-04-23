/**
 * Context-memory tools (scaffold):
 *   memory_put    — insert or update a fact/entity/episode
 *   memory_query  — retrieve non-expired entries by kind/tag/substring
 *   memory_forget — remove by id, key, or tag
 *   memory_stats  — store summary & expired-sweep
 *
 * Storage lives at `~/.cache/airmcp/memory.json` (configurable via
 * PATHS.MEMORY_STORE). See store.ts for the record shape.
 */

import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { z } from "zod";
import { okStructured, errInvalidInput, toolError } from "../shared/result.js";
import { MemoryStore, type MemoryKind } from "./store.js";

const kindSchema = z.enum(["fact", "entity", "episode"]);

// Shared entry shape for outputSchema fields. Keeps put/query output
// shapes in sync so the Wave 2 drift-guard can assert one schema rather
// than duplicating the same 9 fields in three places.
const memoryEntrySchema = z.object({
  id: z.string(),
  kind: kindSchema,
  key: z.string(),
  value: z.string(),
  tags: z.array(z.string()),
  source: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional(),
});

export function registerMemoryTools(server: McpServer, _config: AirMcpConfig): void {
  const store = new MemoryStore();

  server.registerTool(
    "memory_put",
    {
      title: "Remember a Fact, Entity, or Episode",
      description:
        "Insert or update a context-memory entry. Use `fact` for durable key→value notes, " +
        "`entity` for named people/places/projects, and `episode` for time-anchored records. " +
        "If you omit `id`, the key is used as the stable id (so a second call with the same " +
        "key upserts). `ttl_ms` makes the entry self-expiring.",
      inputSchema: {
        kind: kindSchema.describe("Entry category: fact | entity | episode"),
        key: z.string().min(1).describe("Stable label (e.g. 'favorite_editor', 'person:Ada')"),
        value: z.string().describe("Payload. JSON-stringify structured data upstream."),
        id: z.string().optional().describe("Override the default `${kind}:${key}` id"),
        tags: z.array(z.string()).optional().describe("Optional tags for later filtering"),
        source: z.string().optional().describe("Originator — tool name, skill id, 'user' …"),
        ttl_ms: z.number().int().positive().optional().describe("Self-expire after N milliseconds"),
      },
      outputSchema: {
        stored: memoryEntrySchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ kind, key, value, id, tags, source, ttl_ms }) => {
      try {
        const entry = await store.put({
          kind: kind as MemoryKind,
          key,
          value,
          id,
          tags,
          source,
          ttlMs: ttl_ms,
        });
        return okStructured({ stored: entry });
      } catch (e) {
        return toolError("store memory entry", e);
      }
    },
  );

  server.registerTool(
    "memory_query",
    {
      title: "Query Context Memory",
      description:
        "List non-expired memory entries. All filters are AND-combined. Returns entries " +
        "sorted by `updatedAt` descending by default. Safe read-only — use before composing " +
        "LLM prompts so recent user-supplied context is recalled.",
      inputSchema: {
        kind: kindSchema.optional().describe("Restrict to one kind"),
        contains: z.string().optional().describe("Case-insensitive substring in key or value"),
        tags: z.array(z.string()).optional().describe("Match entries carrying ALL given tags"),
        limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 50, cap 500)"),
        order: z.enum(["desc", "asc"]).optional().describe("Sort by updatedAt (default desc)"),
      },
      outputSchema: {
        total: z.number(),
        entries: z.array(memoryEntrySchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ kind, contains, tags, limit, order }) => {
      try {
        const entries = await store.query({
          kind: kind as MemoryKind | undefined,
          contains,
          tags,
          limit,
          order,
        });
        return okStructured({ total: entries.length, entries });
      } catch (e) {
        return toolError("query memory entries", e);
      }
    },
  );

  server.registerTool(
    "memory_forget",
    {
      title: "Forget Memory Entries",
      description:
        "Delete context-memory entries. Provide exactly one selector: `id` (single entry), " +
        "`key` (all entries with that key), or `tag` (all entries carrying that tag). " +
        "Optional `kind` further restricts the delete within the chosen selector.",
      inputSchema: {
        id: z.string().optional().describe("Exact entry id to remove"),
        key: z.string().optional().describe("Delete all entries with this key"),
        tag: z.string().optional().describe("Delete all entries tagged with this label"),
        kind: kindSchema.optional().describe("Only delete entries of this kind"),
      },
      outputSchema: {
        removed: z.array(z.string()),
        count: z.number(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, key, tag, kind }) => {
      const provided = [id, key, tag].filter(Boolean).length;
      if (provided !== 1) {
        return errInvalidInput("Provide exactly one of: id, key, tag.");
      }
      try {
        const removed = await store.forget({
          id,
          key,
          tag,
          kind: kind as MemoryKind | undefined,
        });
        return okStructured({ removed, count: removed.length });
      } catch (e) {
        return toolError("forget memory entries", e);
      }
    },
  );

  server.registerTool(
    "memory_stats",
    {
      title: "Context Memory Stats",
      description:
        "Summarize the context-memory store: counts by kind, oldest/newest timestamps, " +
        "and on-disk path. Also sweeps any expired entries as a side-effect.",
      inputSchema: {},
      outputSchema: {
        total: z.number(),
        byKind: z.object({ fact: z.number(), entity: z.number(), episode: z.number() }),
        oldest: z.string().optional(),
        newest: z.string().optional(),
        expiredSwept: z.number(),
        path: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const stats = await store.stats();
        return okStructured(stats);
      } catch (e) {
        return toolError("read memory stats", e);
      }
    },
  );
}
