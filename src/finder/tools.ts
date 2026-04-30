import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okLinkedStructured, okStructured, okUntrustedStructured, errJxa } from "../shared/result.js";
import { zFilePath, resolveAndGuard } from "../shared/validate.js";
import {
  searchFilesScript,
  getFileInfoScript,
  setTagsScript,
  recentFilesScript,
  listDirectoryScript,
  moveFileScript,
  trashFileScript,
  createFolderScript,
} from "./scripts.js";

export function registerFinderTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "search_files",
    {
      title: "Search Files",
      description: "Search files using Spotlight (mdfind). Searches file names and content.",
      inputSchema: {
        query: z.string().max(500).describe("Search query (Spotlight syntax)"),
        folder: zFilePath.optional().default("~").describe("Folder to search in (default: home)"),
        limit: z.number().int().min(1).max(200).optional().default(50).describe("Max results (default: 50)"),
      },
      outputSchema: {
        total: z.number(),
        // Per-file `size` / `modificationDate` are optional because the
        // script falls back to a {path, name}-only shape when the per-
        // file stat() shells out fails (e.g. permission denied on a
        // nested result).
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            size: z.number().optional(),
            modificationDate: z.string().nullable().optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, folder, limit }) => {
      try {
        return okLinkedStructured("search_files", await runJxa(searchFilesScript(folder, query, limit)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to search files: ${msg}`);
      }
    },
  );

  server.registerTool(
    "get_file_info",
    {
      title: "Get File Info",
      description: "Get detailed file information including size, dates, kind, and tags.",
      inputSchema: {
        path: zFilePath.describe("Absolute file path"),
      },
      outputSchema: {
        path: z.string(),
        name: z.string(),
        kind: z.string(),
        size: z.number(),
        creationDate: z.string(),
        modificationDate: z.string(),
        tags: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        return okUntrustedStructured(await runJxa(getFileInfoScript(path)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to get file info: ${msg}`);
      }
    },
  );

  server.registerTool(
    "set_file_tags",
    {
      title: "Set File Tags",
      description: "Set Finder tags on a file. Replaces all existing tags.",
      inputSchema: {
        path: zFilePath.describe("Absolute file path"),
        tags: z.array(z.string()).describe("Array of tag names to set"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path, tags }) => {
      try {
        return ok(await runJxa(setTagsScript(path, tags)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to set tags: ${msg}`);
      }
    },
  );

  server.registerTool(
    "recent_files",
    {
      title: "Recent Files",
      description: "Find recently modified files in a folder using Spotlight.",
      inputSchema: {
        folder: zFilePath.optional().default("~").describe("Folder to search (default: home)"),
        days: z.number().int().min(1).max(365).optional().default(7).describe("Modified within N days (default: 7)"),
        limit: z.number().int().min(1).max(200).optional().default(30).describe("Max results (default: 30)"),
      },
      outputSchema: {
        total: z.number(),
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ folder, days, limit }) => {
      try {
        return okStructured(await runJxa(recentFilesScript(folder, days, limit)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to find recent files: ${msg}`);
      }
    },
  );

  server.registerTool(
    "list_directory",
    {
      title: "List Directory",
      description: "List files and folders in a directory with metadata (kind, size, modification date).",
      inputSchema: {
        path: zFilePath.describe("Absolute directory path"),
        limit: z.number().int().min(1).max(500).optional().default(100).describe("Max items to return (default: 100)"),
      },
      outputSchema: {
        total: z.number(),
        returned: z.number(),
        items: z.array(
          z.object({
            name: z.string(),
            kind: z.string(),
            size: z.number().optional(),
            modificationDate: z.string().optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path, limit }) => {
      try {
        return okUntrustedStructured(await runJxa(listDirectoryScript(path, limit)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to list directory: ${msg}`);
      }
    },
  );

  server.registerTool(
    "move_file",
    {
      title: "Move File",
      description: "Move or rename a file or folder to a new location.",
      inputSchema: {
        source: zFilePath.describe("Absolute path of the file or folder to move"),
        destination: zFilePath.describe("Absolute destination path"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ source, destination }) => {
      try {
        resolveAndGuard(source);
        resolveAndGuard(destination);
        return ok(await runJxa(moveFileScript(source, destination)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to move file: ${msg}`);
      }
    },
  );

  server.registerTool(
    "trash_file",
    {
      title: "Trash File",
      description: "Move a file or folder to the Trash using Finder.",
      inputSchema: {
        path: zFilePath.describe("Absolute path of the file or folder to trash"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        resolveAndGuard(path);
        return ok(await runJxa(trashFileScript(path)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to trash file: ${msg}`);
      }
    },
  );

  server.registerTool(
    "create_directory",
    {
      title: "Create Directory",
      description: "Create a new directory (and intermediate directories if needed).",
      inputSchema: {
        path: zFilePath.describe("Absolute path of the folder to create"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        resolveAndGuard(path);
        return ok(await runJxa(createFolderScript(path)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errJxa(`Failed to create folder: ${msg}`);
      }
    },
  );
}
