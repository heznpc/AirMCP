import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import { runSwift } from "../shared/swift.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, err } from "../shared/result.js";
import { zFilePath } from "../shared/validate.js";
import {
  listAlbumsScript,
  listPhotosScript,
  searchPhotosScript,
  getPhotoInfoScript,
  listFavoritesScript,
  createAlbumScript,
  addToAlbumScript,
} from "./scripts.js";

interface PhotoImportResult {
  imported: boolean;
  identifier: string | null;
}

interface PhotoDeleteResult {
  deleted: number;
  identifiers: string[];
}

export function registerPhotosTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool("list_albums", {
    title: "List Photo Albums",
    description: "List all photo albums with name and item count.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try { return ok(await runJxa(listAlbumsScript())); }
    catch (e) { return err(`Failed to list albums: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool("list_photos", {
    title: "List Photos",
    description: "List photos in an album with metadata. Use list_albums to find album names first.",
    inputSchema: {
      album: z.string().describe("Album name"),
      limit: z.number().int().min(1).max(500).optional().default(50).describe("Max photos (default: 50)"),
      offset: z.number().int().min(0).optional().default(0).describe("Offset for pagination (default: 0)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ album, limit, offset }) => {
    try { return ok(await runJxa(listPhotosScript(album, limit, offset))); }
    catch (e) { return err(`Failed to list photos: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool("search_photos", {
    title: "Search Photos",
    description: "Search photos by filename, name, or description keyword.",
    inputSchema: {
      query: z.string().describe("Search keyword"),
      limit: z.number().int().min(1).max(200).optional().default(30).describe("Max results (default: 30)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, limit }) => {
    try { return ok(await runJxa(searchPhotosScript(query, limit))); }
    catch (e) { return err(`Failed to search photos: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool("get_photo_info", {
    title: "Get Photo Info",
    description: "Get detailed metadata for a specific photo by ID.",
    inputSchema: {
      id: z.string().describe("Photo media item ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    try { return ok(await runJxa(getPhotoInfoScript(id))); }
    catch (e) { return err(`Failed to get photo info: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool("list_favorites", {
    title: "List Favorite Photos",
    description: "List photos marked as favorites.",
    inputSchema: {
      limit: z.number().int().min(1).max(500).optional().default(50).describe("Max photos (default: 50)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit }) => {
    try { return ok(await runJxa(listFavoritesScript(limit))); }
    catch (e) { return err(`Failed to list favorites: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool("create_album", {
    title: "Create Album",
    description: "Create a new photo album.",
    inputSchema: {
      name: z.string().describe("Album name"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name }) => {
    try { return ok(await runJxa(createAlbumScript(name))); }
    catch (e) { return err(`Failed to create album: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool("add_to_album", {
    title: "Add Photos to Album",
    description: "Add photos to an existing album by photo IDs and album name.",
    inputSchema: {
      photoIds: z.array(z.string()).describe("Array of photo media item IDs"),
      albumName: z.string().describe("Target album name"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ photoIds, albumName }) => {
    try { return ok(await runJxa(addToAlbumScript(photoIds, albumName))); }
    catch (e) { return err(`Failed to add photos to album: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.registerTool(
    "import_photo",
    {
      title: "Import Photo",
      description:
        "Import a photo from a file path into Photos library. Optionally add to an existing album. Requires macOS 26+ Swift bridge.",
      inputSchema: {
        filePath: zFilePath.describe("Absolute file path to the image file to import"),
        albumName: z.string().optional().describe("Album to add the imported photo to (must already exist)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ filePath, albumName }) => {
      try {
        const result = await runSwift<PhotoImportResult>(
          "import-photo",
          JSON.stringify({ filePath, albumName }),
        );
        return ok(result);
      } catch (e) {
        return err(`Failed to import photo: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "delete_photos",
    {
      title: "Delete Photos",
      description:
        "Delete photos by local identifier. Shows macOS confirmation dialog for user approval. Requires macOS 26+ Swift bridge.",
      inputSchema: {
        identifiers: z.array(z.string()).describe("Array of photo local identifiers to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ identifiers }) => {
      try {
        const result = await runSwift<PhotoDeleteResult>(
          "delete-photos",
          JSON.stringify({ identifiers }),
        );
        return ok(result);
      } catch (e) {
        return err(`Failed to delete photos: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
