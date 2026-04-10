import { z } from "zod";
import { realpathSync } from "node:fs";
import { HOME } from "./constants.js";

/** Type guard for a plain JSON object (not null, not an array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Zod schema for file path parameters.
 * Accepts absolute paths (/) and tilde paths (~/).
 * Tilde is resolved to HOME before reaching tool handlers.
 * Blocks path traversal (.. as a path segment).
 *
 * Usage: `path: zFilePath.describe("Absolute file path")`
 */
export const zFilePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => p.startsWith("/") || p.startsWith("~/") || p === "~", "File path must be absolute (use / or ~/)")
  .transform((p) => (p.startsWith("~/") ? `${HOME}${p.slice(1)}` : p === "~" ? HOME : p))
  .refine((p) => !/(^|\/)\.\.($|\/)/.test(p), "Path traversal is not allowed");

/**
 * Resolve a path through symlinks and verify it hasn't escaped a safe prefix.
 * Call this in tool handlers that perform mutating file operations (move, trash, write)
 * to prevent symlink-based traversal attacks.
 *
 * @param filePath - The validated path from zFilePath
 * @param safePrefix - Allowed root directory (defaults to HOME)
 * @returns The resolved real path
 * @throws If the resolved path is outside safePrefix
 */
export function resolveAndGuard(filePath: string, safePrefix: string = HOME): string {
  try {
    const real = realpathSync(filePath);
    if (!real.startsWith(safePrefix + "/") && real !== safePrefix) {
      throw new Error(`Path resolves outside allowed directory: ${real}`);
    }
    return real;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Path resolves outside")) throw e;
    // File doesn't exist yet — validate parent directory instead
    const parent = filePath.replace(/\/[^/]+$/, "");
    if (!parent || parent === filePath) throw new Error(`Cannot resolve parent for path: ${filePath}`, { cause: e });
    try {
      const realParent = realpathSync(parent);
      if (!realParent.startsWith(safePrefix + "/") && realParent !== safePrefix) {
        throw new Error(`Path resolves outside allowed directory: ${realParent}`, { cause: e });
      }
      return filePath;
    } catch (pe) {
      if (pe instanceof Error && pe.message.startsWith("Path resolves outside")) throw pe;
      // Parent doesn't exist either — the path can't escape via symlink
      return filePath;
    }
  }
}
