import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { LIMITS } from "../shared/constants.js";
import {
  ok,
  okLinked,
  okLinkedStructured,
  okUntrusted,
  okUntrustedStructured,
  errPermission,
  toolError,
} from "../shared/result.js";
import { filterSharedAccess, guardSharedAccess } from "../shared/share-guard.js";
import type { Shareable, MutationResult, DeleteResult } from "../shared/types.js";
import {
  listNotesScript,
  searchNotesScript,
  readNoteScript,
  createNoteScript,
  createNoteSharedScript,
  updateNoteScript,
  deleteNoteScript,
  guardSharedScript,
  guardSharedBulkScript,
  listFoldersScript,
  createFolderScript,
  scanNotesScript,
  compareNotesScript,
  moveNoteScript,
  bulkMoveNotesScript,
} from "./scripts.js";

interface NoteListItem extends Shareable {
  id: string;
  name: string;
  folder: string;
  creationDate: string;
  modificationDate: string;
}

interface SearchResult extends NoteListItem {
  preview: string;
}

interface NoteDetail extends NoteListItem {
  body: string;
  plaintext: string;
  passwordProtected: boolean;
}

interface FolderItem extends Shareable {
  id: string;
  name: string;
  account: string;
  noteCount: number;
}

interface ScanNote extends NoteListItem {
  preview: string;
  charCount: number;
}

interface ScanResult {
  total: number;
  offset: number;
  returned: number;
  notes: ScanNote[];
}

interface CompareResult extends Shareable {
  id: string;
  name: string;
  plaintext: string;
  folder: string;
  creationDate: string;
  modificationDate: string;
  charCount: number;
}

async function guardShared(id: string, config: AirMcpConfig, toolName: string): Promise<string | null> {
  if (config.includeShared) return null;
  const result = await runJxa<{ shared: boolean }>(guardSharedScript(id));
  return guardSharedAccess(result.shared, config, "notes", toolName, { id });
}

export function registerNoteTools(server: McpServer, config: AirMcpConfig): void {
  // --- Layer 1: CRUD ---

  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description:
        "List all notes with title, folder, and dates. Optionally filter by folder name. Supports pagination via limit/offset.",
      inputSchema: {
        folder: z.string().max(500).optional().describe("Filter by folder name"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(200)
          .describe("Max number of notes to return (default: 200)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Number of notes to skip for pagination (default: 0)"),
      },
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        returned: z.number(),
        notes: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            folder: z.string(),
            // `shared` is always emitted by the JXA runtime (via Shareable) and
            // is useful signal for clients (e.g. to render a "shared" badge).
            // Declared here so the outputSchema drift guard can run in strict mode.
            shared: z.boolean(),
            creationDate: z.string(),
            modificationDate: z.string(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ folder, limit, offset }) => {
      try {
        const result = await runJxa<{ total: number; offset: number; returned: number; notes: NoteListItem[] }>(
          listNotesScript(limit, offset, folder),
        );
        result.notes = filterSharedAccess(result.notes, config, "notes");
        result.returned = result.notes.length;
        return okLinkedStructured("list_notes", result);
      } catch (e) {
        return toolError("list notes", e);
      }
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search Notes",
      description: "Search notes by keyword in title and body. Returns matching notes with a 200-char preview.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("Search keyword"),
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Max results to return (default: 50)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Number of matching results to skip (for pagination)"),
      },
      outputSchema: {
        total: z.number(),
        returned: z.number(),
        offset: z.number(),
        notes: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            folder: z.string(),
            preview: z.string(),
            creationDate: z.string(),
            modificationDate: z.string(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, limit, offset }) => {
      try {
        const result = await runJxa<{ total: number; returned: number; offset: number; notes: SearchResult[] }>(
          searchNotesScript(query, limit, offset),
        );
        result.notes = filterSharedAccess(result.notes, config, "notes");
        result.returned = result.notes.length;
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("search notes", e);
      }
    },
  );

  server.registerTool(
    "read_note",
    {
      title: "Read Note",
      description: "Read the full content of a specific note by its ID. Returns HTML body and plaintext.",
      inputSchema: {
        id: z.string().max(500).describe("Note ID (x-coredata:// format)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const result = await runJxa<NoteDetail>(readNoteScript(id));
        const blocked = await guardSharedAccess(result.shared, config, "notes", "read_note", { id });
        if (blocked) return errPermission(blocked);
        return okUntrusted(result);
      } catch (e) {
        return toolError("read note", e);
      }
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create Note",
      description:
        "Create a new note with HTML body. The first line of the body becomes the note title automatically. Optionally specify a target folder.",
      inputSchema: {
        body: z.string().max(50000).describe("Note content in HTML (e.g. '<h1>Title</h1><p>Body text</p>')"),
        folder: z.string().max(500).optional().describe("Target folder name"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ body, folder }) => {
      try {
        const script = config.includeShared ? createNoteSharedScript(body, folder) : createNoteScript(body, folder);
        const result = await runJxa<MutationResult>(script);
        return okLinked("create_note", result);
      } catch (e) {
        return toolError("create note", e);
      }
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Update Note",
      description:
        "Replace the entire body of an existing note. WARNING: This overwrites all content. Read the note first if you need to preserve parts of it. Attachments may be lost.",
      inputSchema: {
        id: z.string().max(500).describe("Note ID (x-coredata:// format)"),
        body: z.string().max(50000).describe("New HTML body to replace existing content"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, body }) => {
      try {
        const blocked = await guardShared(id, config, "update_note");
        if (blocked) return errPermission(blocked);
        const result = await runJxa<MutationResult>(updateNoteScript(id, body));
        return ok(result);
      } catch (e) {
        return toolError("update note", e);
      }
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete Note",
      description: "Delete a note by ID. The note is moved to Recently Deleted and permanently removed after 30 days.",
      inputSchema: {
        id: z.string().max(500).describe("Note ID (x-coredata:// format)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const blocked = await guardShared(id, config, "delete_note");
        if (blocked) return errPermission(blocked);
        const result = await runJxa<DeleteResult>(deleteNoteScript(id));
        return ok(result);
      } catch (e) {
        return toolError("delete note", e);
      }
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List Folders",
      description: "List all folders across all accounts with note counts.",
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
        const result = await runJxa<FolderItem[]>(listFoldersScript());
        return ok(filterSharedAccess(result, config, "notes"));
      } catch (e) {
        return toolError("list folders", e);
      }
    },
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create Folder",
      description: "Create a new folder. Optionally specify which account to create it in.",
      inputSchema: {
        name: z.string().max(500).describe("Folder name"),
        account: z.string().max(500).optional().describe("Account name (e.g. 'iCloud'). Defaults to primary account."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, account }) => {
      try {
        const result = await runJxa<MutationResult>(createFolderScript(name, account));
        return ok(result);
      } catch (e) {
        return toolError("create folder", e);
      }
    },
  );

  server.registerTool(
    "move_note",
    {
      title: "Move Note",
      description:
        "Move a note to a different folder. NOTE: Apple Notes has no native move command, so this copies the note body to the target folder and deletes the original. The note will get a new ID and creation date. Attachments (images) will be lost.",
      inputSchema: {
        id: z.string().max(500).describe("Note ID to move"),
        folder: z.string().max(500).describe("Target folder name"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, folder }) => {
      try {
        const blocked = await guardShared(id, config, "move_note");
        if (blocked) return errPermission(blocked);
        const result = await runJxa<MutationResult>(moveNoteScript(id, folder));
        return ok(result);
      } catch (e) {
        return toolError("move note", e);
      }
    },
  );

  // --- Layer 2: Bulk ---

  server.registerTool(
    "scan_notes",
    {
      title: "Scan Notes",
      description:
        "Bulk scan notes returning metadata and a text preview for each. Supports pagination via offset. Optionally filter by folder. Use this to get an overview before organizing.",
      inputSchema: {
        folder: z.string().max(500).optional().describe("Filter by folder name. Omit to scan all notes."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.NOTES_BULK_SCAN)
          .optional()
          .default(100)
          .describe("Max number of notes to return (default: 100)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Number of notes to skip for pagination (default: 0)"),
        previewLength: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .default(300)
          .describe("Preview text length in characters (default: 300)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ folder, limit, offset, previewLength }) => {
      try {
        const result = await runJxa<ScanResult>(scanNotesScript(limit, previewLength, offset, folder));
        result.notes = filterSharedAccess(result.notes, config, "notes");
        result.returned = result.notes.length;
        return okUntrusted(result);
      } catch (e) {
        return toolError("scan notes", e);
      }
    },
  );

  server.registerTool(
    "compare_notes",
    {
      title: "Compare Notes",
      description:
        "Retrieve full plaintext content of 2-5 notes at once for comparison. Use this after scan_notes to safely compare potentially duplicate or similar notes before deciding what to keep, merge, or delete.",
      inputSchema: {
        ids: z.array(z.string()).min(2).max(5).describe("Array of 2-5 note IDs to compare"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ ids }) => {
      try {
        const result = await runJxa<CompareResult[]>(compareNotesScript(ids));
        const shared = result.filter((n) => n.shared);
        if (shared.length > 0) {
          // Check first shared note to determine if access is allowed
          const blocked = await guardSharedAccess(true, config, "notes", "compare_notes", { ids });
          if (blocked) return errPermission(blocked);
        }
        return okUntrusted(result);
      } catch (e) {
        return toolError("compare notes", e);
      }
    },
  );

  server.registerTool(
    "bulk_move_notes",
    {
      title: "Bulk Move Notes",
      description:
        "Move multiple notes to a target folder at once. Same limitations as move_note apply to each note (new ID, date reset, attachments lost). Returns per-note success/failure results.",
      inputSchema: {
        ids: z.array(z.string().max(500)).min(1).max(100).describe("Array of note IDs to move (max 100)"),
        folder: z.string().max(500).describe("Target folder name"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ ids, folder }) => {
      try {
        if (!config.includeShared) {
          const { sharedIds } = await runJxa<{ sharedIds: string[] }>(guardSharedBulkScript(ids));
          if (sharedIds.length > 0) {
            const blocked = await guardSharedAccess(true, config, "notes", "bulk_move_notes", { ids, folder });
            if (blocked) return errPermission(blocked);
          }
        }
        const result = await runJxa<unknown>(bulkMoveNotesScript(ids, folder));
        return ok(result);
      } catch (e) {
        return toolError("bulk move notes", e);
      }
    },
  );
}
