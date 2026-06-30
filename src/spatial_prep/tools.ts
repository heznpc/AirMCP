import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { z } from "zod";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { okUntrustedStructured, errInvalidInput, errNotFound, toolError } from "../shared/result.js";
import { zFilePath } from "../shared/validate.js";

const ASSET_EXTENSIONS = [".usdz", ".reality", ".glb", ".gltf", ".obj", ".fbx", ".hdr", ".exr"] as const;
const ASSET_EXTENSION_SET = new Set<string>(ASSET_EXTENSIONS);
const TEXT_CONTEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml"]);
const NEARBY_CONTEXT_EXTENSIONS = new Set([
  ...ASSET_EXTENSIONS,
  ".mtl",
  ".usda",
  ".usd",
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".tif",
  ".tiff",
  ".webp",
  ...TEXT_CONTEXT_EXTENSIONS,
]);

const MAX_TEXT_FILE_BYTES = 64_000;

const assetExtensionSchema = z.enum(ASSET_EXTENSIONS);

interface SpatialAsset {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

interface NearbyFile extends SpatialAsset {
  kind: "asset" | "material" | "texture" | "metadata" | "context";
}

export function registerSpatialPrepTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_vr_assets",
    {
      title: "List VR Assets",
      description:
        "Read-only scan for spatial/VR asset files under a user-provided folder. Returns metadata only; does not read binary asset contents.",
      inputSchema: {
        root: zFilePath.describe("Absolute folder path to scan"),
        extensions: z
          .array(assetExtensionSchema)
          .max(ASSET_EXTENSIONS.length)
          .optional()
          .describe("Asset extensions to include"),
        limit: z.number().int().min(1).max(50).optional().default(50).describe("Max assets to return (default 50)"),
        cursor: z.number().int().min(0).optional().default(0).describe("Result offset for pagination"),
        maxDepth: z.number().int().min(0).max(12).optional().default(6).describe("Max directory depth to scan"),
        maxEntries: z
          .number()
          .int()
          .min(100)
          .max(10_000)
          .optional()
          .default(10_000)
          .describe("Max filesystem entries to inspect before stopping"),
        includeHidden: z.boolean().optional().default(false).describe("Include dotfiles and dot directories"),
      },
      outputSchema: {
        root: z.string(),
        extensions: z.array(z.string()),
        scannedEntries: z.number().int(),
        skippedSymlinks: z.number().int(),
        truncated: z.boolean(),
        total: z.number().int(),
        returned: z.number().int(),
        nextCursor: z.number().int().nullable(),
        assets: z.array(
          z.object({
            path: z.string(),
            relativePath: z.string(),
            name: z.string(),
            extension: z.string(),
            size: z.number().int(),
            modifiedAt: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ root, extensions, limit, cursor, maxDepth, maxEntries, includeHidden }) => {
      const allowed = normalizeAssetExtensions(extensions);
      if (!allowed.ok) return errInvalidInput(allowed.message);

      try {
        const result = await scanSpatialAssets({
          root,
          extensions: allowed.extensions,
          limit,
          cursor,
          maxDepth,
          maxEntries,
          includeHidden,
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return formatFsError("list VR assets", e);
      }
    },
  );

  server.registerTool(
    "get_vr_asset_context",
    {
      title: "Get VR Asset Context",
      description:
        "Read-only context bundle for one spatial/VR asset: file metadata, nearby textures/materials/metadata, and bounded text excerpts from adjacent context files.",
      inputSchema: {
        assetPath: zFilePath.describe("Absolute path to a VR/spatial asset"),
        root: zFilePath.optional().describe("Optional root folder; asset must resolve inside it when provided"),
        nearbyLimit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Max nearby context files to return"),
        maxTextChars: z
          .number()
          .int()
          .min(0)
          .max(8_000)
          .optional()
          .default(2_000)
          .describe("Max characters per adjacent text context file"),
        includeHidden: z.boolean().optional().default(false).describe("Include dotfiles in nearby context"),
      },
      outputSchema: {
        asset: z.object({
          path: z.string(),
          name: z.string(),
          extension: z.string(),
          size: z.number().int(),
          modifiedAt: z.string(),
        }),
        root: z.string().nullable(),
        directory: z.string(),
        nearby: z.object({
          total: z.number().int(),
          returned: z.number().int(),
          files: z.array(
            z.object({
              path: z.string(),
              relativePath: z.string(),
              name: z.string(),
              extension: z.string(),
              kind: z.enum(["asset", "material", "texture", "metadata", "context"]),
              size: z.number().int(),
              modifiedAt: z.string(),
            }),
          ),
        }),
        textContext: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            extension: z.string(),
            size: z.number().int(),
            excerpt: z.string(),
            truncated: z.boolean(),
          }),
        ),
        notes: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ assetPath, root, nearbyLimit, maxTextChars, includeHidden }) => {
      try {
        const result = await buildAssetContext({ assetPath, root, nearbyLimit, maxTextChars, includeHidden });
        return okUntrustedStructured(result);
      } catch (e) {
        return formatFsError("get VR asset context", e);
      }
    },
  );
}

function normalizeAssetExtensions(
  input: string[] | undefined,
): { ok: true; extensions: Set<string> } | { ok: false; message: string } {
  if (!input || input.length === 0) return { ok: true, extensions: new Set(ASSET_EXTENSIONS) };
  const normalized = new Set<string>();
  for (const raw of input) {
    const ext = raw.toLowerCase();
    if (!ASSET_EXTENSION_SET.has(ext)) {
      return { ok: false, message: `Unsupported VR asset extension: ${raw}` };
    }
    normalized.add(ext);
  }
  return { ok: true, extensions: normalized };
}

async function scanSpatialAssets(options: {
  root: string;
  extensions: Set<string>;
  limit: number;
  cursor: number;
  maxDepth: number;
  maxEntries: number;
  includeHidden: boolean;
}) {
  const root = await realpath(options.root);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`not a directory: ${options.root}`);
  }

  const assets: SpatialAsset[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let scannedEntries = 0;
  let skippedSymlinks = 0;
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!options.includeHidden && entry.name.startsWith(".")) continue;
      scannedEntries += 1;
      if (scannedEntries > options.maxEntries) {
        truncated = true;
        break;
      }

      const fullPath = join(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < options.maxDepth) queue.push({ path: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = extname(entry.name).toLowerCase();
      if (!options.extensions.has(extension)) continue;
      const fileStat = await stat(fullPath);
      assets.push(toAsset(root, fullPath, fileStat.size, fileStat.mtime));
    }

    if (truncated) break;
  }

  assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const page = assets.slice(options.cursor, options.cursor + options.limit);
  const nextCursor = options.cursor + page.length < assets.length ? options.cursor + page.length : null;

  return {
    root,
    extensions: [...options.extensions].sort(),
    scannedEntries: Math.min(scannedEntries, options.maxEntries),
    skippedSymlinks,
    truncated: truncated || queue.length > 0,
    total: assets.length,
    returned: page.length,
    nextCursor,
    assets: page,
  };
}

async function buildAssetContext(options: {
  assetPath: string;
  root?: string;
  nearbyLimit: number;
  maxTextChars: number;
  includeHidden: boolean;
}) {
  const assetPath = await realpath(options.assetPath);
  const assetStat = await stat(assetPath);
  if (!assetStat.isFile()) {
    throw new Error(`not a file: ${options.assetPath}`);
  }

  const extension = extname(assetPath).toLowerCase();
  if (!ASSET_EXTENSION_SET.has(extension)) {
    throw new Error(`unsupported VR asset extension: ${extension || "(none)"}`);
  }

  const root = options.root ? await realpath(options.root) : null;
  if (root && !isInside(root, assetPath)) {
    throw new Error(`asset is outside root: ${options.assetPath}`);
  }

  const directory = dirname(assetPath);
  const nearby = await listNearbyFiles(
    directory,
    root ?? directory,
    assetPath,
    options.nearbyLimit,
    options.includeHidden,
  );
  const textContext = await readTextContext(nearby.files, options.maxTextChars);

  return {
    asset: {
      path: assetPath,
      name: basename(assetPath),
      extension,
      size: assetStat.size,
      modifiedAt: assetStat.mtime.toISOString(),
    },
    root,
    directory,
    nearby,
    textContext,
    notes: [
      "Binary asset contents are not read.",
      "Adjacent text is returned as untrusted context and is bounded by maxTextChars.",
    ],
  };
}

async function listNearbyFiles(
  directory: string,
  root: string,
  assetPath: string,
  nearbyLimit: number,
  includeHidden: boolean,
): Promise<{ total: number; returned: number; files: NearbyFile[] }> {
  const files: NearbyFile[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!includeHidden && entry.name.startsWith(".")) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) continue;

    const path = join(directory, entry.name);
    if (path === assetPath) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!NEARBY_CONTEXT_EXTENSIONS.has(extension)) continue;

    const fileStat = await stat(path);
    files.push({
      ...toAsset(root, path, fileStat.size, fileStat.mtime),
      kind: classifyNearbyFile(extension),
    });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const page = files.slice(0, nearbyLimit);
  return { total: files.length, returned: page.length, files: page };
}

async function readTextContext(files: NearbyFile[], maxTextChars: number) {
  if (maxTextChars === 0) return [];
  const out: Array<{
    path: string;
    name: string;
    extension: string;
    size: number;
    excerpt: string;
    truncated: boolean;
  }> = [];
  for (const file of files) {
    if (!TEXT_CONTEXT_EXTENSIONS.has(file.extension) || file.size > MAX_TEXT_FILE_BYTES) continue;
    const text = await readFile(file.path, "utf8");
    const excerpt = cleanText(text).slice(0, maxTextChars);
    out.push({
      path: file.path,
      name: file.name,
      extension: file.extension,
      size: file.size,
      excerpt,
      truncated: text.length > maxTextChars,
    });
  }
  return out;
}

function toAsset(root: string, path: string, size: number, mtime: Date): SpatialAsset {
  return {
    path,
    relativePath: relative(root, path) || basename(path),
    name: basename(path),
    extension: extname(path).toLowerCase(),
    size,
    modifiedAt: mtime.toISOString(),
  };
}

function classifyNearbyFile(extension: string): NearbyFile["kind"] {
  if (ASSET_EXTENSION_SET.has(extension)) return "asset";
  if (extension === ".mtl" || extension === ".usd" || extension === ".usda") return "material";
  if (TEXT_CONTEXT_EXTENSIONS.has(extension)) return "metadata";
  if ([".png", ".jpg", ".jpeg", ".heic", ".tif", ".tiff", ".webp", ".hdr", ".exr"].includes(extension)) {
    return "texture";
  }
  return "context";
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function cleanText(text: string): string {
  return text.split("\0").join("").replace(/\r\n/g, "\n").trim();
}

function formatFsError(action: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("ENOENT") || message.toLowerCase().includes("not found")) {
    return errNotFound(`Failed to ${action}: ${message}`);
  }
  if (
    message.startsWith("not a directory:") ||
    message.startsWith("not a file:") ||
    message.startsWith("asset is outside root:") ||
    message.startsWith("unsupported VR asset extension:")
  ) {
    return errInvalidInput(`Failed to ${action}: ${message}`);
  }
  return toolError(action, e);
}
