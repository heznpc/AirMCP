import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runSwift } from "../shared/swift.js";
import { runAutomation } from "../shared/automation.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, toolError } from "../shared/result.js";
import { zFilePath, resolveAndGuard } from "../shared/validate.js";
import {
  listAlbumsScript,
  listPhotosScript,
  searchPhotosScript,
  getPhotoInfoScript,
  listFavoritesScript,
  createAlbumScript,
  addToAlbumScript,
} from "./scripts.js";

interface AlbumItem {
  id: string;
  name: string;
  count: number;
}

interface PhotoListItem {
  id: string;
  filename: string | null;
  name: string | null;
  date: string | null;
  width: number;
  height: number;
  favorite: boolean;
}

interface PhotoListResult {
  total: number;
  offset: number;
  returned: number;
  photos: PhotoListItem[];
}

interface SearchPhotoItem {
  id: string;
  filename: string | null;
  name: string | null;
  date: string | null;
  favorite: boolean;
  description: string | null;
}

interface SearchPhotosResult {
  total: number;
  photos: SearchPhotoItem[];
}

interface PhotoDetail {
  id: string;
  filename: string | null;
  name: string | null;
  description: string | null;
  date: string | null;
  width: number;
  height: number;
  altitude: number | null;
  location: number[] | null;
  favorite: boolean;
  keywords: string[] | null;
}

interface FavoritesResult {
  total: number;
  returned: number;
  photos: PhotoListItem[];
}

interface CreateAlbumResult {
  id: string;
  name: string;
}

interface AddToAlbumResult {
  added: number;
  album: string;
}

interface PhotoImportResult {
  imported: boolean;
  identifier: string | null;
}

interface PhotoDeleteResult {
  deleted: number;
  identifiers: string[];
}

export function registerPhotosTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_albums",
    {
      title: "List Photo Albums",
      description: "List all photo albums with name and item count.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await runAutomation<AlbumItem[]>({
          swift: { command: "list-albums" },
          jxa: () => listAlbumsScript(),
        });
        return okUntrusted(result);
      } catch (e) {
        return toolError("list albums", e);
      }
    },
  );

  server.registerTool(
    "list_photos",
    {
      title: "List Photos",
      description: "List photos in an album with metadata. Use list_albums to find album names first.",
      inputSchema: {
        album: z.string().max(500).describe("Album name"),
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Max photos (default: 50)"),
        offset: z.number().int().min(0).optional().default(0).describe("Offset for pagination (default: 0)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ album, limit, offset }) => {
      try {
        const result = await runAutomation<PhotoListResult>({
          swift: {
            command: "list-photos",
            input: { albumName: album, limit, offset },
          },
          jxa: () => listPhotosScript(album, limit, offset),
        });
        return okUntrusted(result);
      } catch (e) {
        return toolError("list photos", e);
      }
    },
  );

  server.registerTool(
    "search_photos",
    {
      title: "Search Photos",
      description: "Search photos by filename, name, or description keyword.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        limit: z.number().int().min(1).max(200).optional().default(30).describe("Max results (default: 30)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const result = await runAutomation<SearchPhotosResult>({
          swift: {
            command: "search-photos",
            input: { query, limit },
          },
          jxa: () => searchPhotosScript(query, limit),
        });
        return okUntrusted(result);
      } catch (e) {
        return toolError("search photos", e);
      }
    },
  );

  server.registerTool(
    "get_photo_info",
    {
      title: "Get Photo Info",
      description: "Get detailed metadata for a specific photo by ID.",
      inputSchema: {
        id: z.string().max(500).describe("Photo media item ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        const result = await runAutomation<PhotoDetail>({
          swift: {
            command: "get-photo-info",
            input: { id },
          },
          jxa: () => getPhotoInfoScript(id),
        });
        return okUntrusted(result);
      } catch (e) {
        return toolError("get photo info", e);
      }
    },
  );

  server.registerTool(
    "list_favorites",
    {
      title: "List Favorite Photos",
      description: "List photos marked as favorites.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Max photos (default: 50)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      try {
        const result = await runAutomation<FavoritesResult>({
          swift: {
            command: "list-favorites",
            input: { limit },
          },
          jxa: () => listFavoritesScript(limit),
        });
        return ok(result);
      } catch (e) {
        return toolError("list favorites", e);
      }
    },
  );

  server.registerTool(
    "create_album",
    {
      title: "Create Album",
      description: "Create a new photo album.",
      inputSchema: {
        name: z.string().max(500).describe("Album name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        const result = await runAutomation<CreateAlbumResult>({
          swift: {
            command: "create-album",
            input: { name },
          },
          jxa: () => createAlbumScript(name),
        });
        return ok(result);
      } catch (e) {
        return toolError("create album", e);
      }
    },
  );

  server.registerTool(
    "add_to_album",
    {
      title: "Add Photos to Album",
      description: "Add photos to an existing album by photo IDs and album name.",
      inputSchema: {
        photoIds: z.array(z.string().max(500)).min(1).max(500).describe("Array of photo media item IDs (max 500)"),
        albumName: z.string().max(500).describe("Target album name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ photoIds, albumName }) => {
      try {
        const result = await runAutomation<AddToAlbumResult>({
          swift: {
            command: "add-to-album",
            input: { photoIds, albumName },
          },
          jxa: () => addToAlbumScript(photoIds, albumName),
        });
        return ok(result);
      } catch (e) {
        return toolError("add photos to album", e);
      }
    },
  );

  server.registerTool(
    "import_photo",
    {
      title: "Import Photo",
      description:
        "Import a photo from a file path into Photos library. Optionally add to an existing album. Requires macOS 26+ Swift bridge.",
      inputSchema: {
        filePath: zFilePath.describe("Absolute file path to the image file to import"),
        albumName: z.string().max(500).optional().describe("Album to add the imported photo to (must already exist)"),
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
        resolveAndGuard(filePath);
        const result = await runSwift<PhotoImportResult>("import-photo", JSON.stringify({ filePath, albumName }));
        return ok(result);
      } catch (e) {
        return toolError("import photo", e);
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
        const result = await runSwift<PhotoDeleteResult>("delete-photos", JSON.stringify({ identifiers }));
        return ok(result);
      } catch (e) {
        return toolError("delete photos", e);
      }
    },
  );

  // --- Advanced Photo Queries (PhotoKit via Swift bridge) ---

  server.registerTool(
    "query_photos",
    {
      title: "Query Photos",
      description:
        "Query the Photos library with filters: media type, date range, favorites. " +
        "Returns photo metadata (identifier, filename, date, dimensions). Requires Swift bridge.",
      inputSchema: {
        mediaType: z.enum(["image", "video", "audio"]).optional().describe("Filter by media type"),
        startDate: z.string().max(64).optional().describe("Start date (ISO 8601)"),
        endDate: z.string().max(64).optional().describe("End date (ISO 8601)"),
        favorites: z.boolean().optional().describe("Only favorites"),
        limit: z.number().int().min(1).max(200).optional().default(50).describe("Max results (default: 50)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ mediaType, startDate, endDate, favorites, limit }) => {
      try {
        const result = await runSwift<{ photos: unknown[]; total: number }>(
          "query-photos",
          JSON.stringify({ mediaType, startDate, endDate, favorites, limit }),
        );
        return ok(result);
      } catch (e) {
        return toolError("query photos", e);
      }
    },
  );

  server.registerTool(
    "classify_image",
    {
      title: "Classify Image",
      description:
        "Classify an image using Apple Vision framework. Returns labels with confidence scores " +
        "(e.g. 'dog', 'outdoor', 'food'). Works on any image file. Requires Swift bridge.",
      inputSchema: {
        imagePath: zFilePath.describe("Absolute path to the image file"),
        maxResults: z.number().int().min(1).max(50).optional().default(10).describe("Max labels (default: 10)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ imagePath, maxResults }) => {
      try {
        const result = await runSwift<{ labels: unknown[]; total: number }>(
          "classify-image",
          JSON.stringify({ imagePath, maxResults }),
        );
        return ok(result);
      } catch (e) {
        return toolError("classify image", e);
      }
    },
  );
}
