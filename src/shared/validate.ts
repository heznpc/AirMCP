import { z } from "zod";
import { HOME } from "./constants.js";

/**
 * Zod schema for file path parameters.
 * Accepts absolute paths (/) and tilde paths (~/).
 * Tilde is resolved to HOME before reaching tool handlers.
 * Blocks path traversal (.. as a path segment).
 *
 * Usage: `path: zFilePath.describe("Absolute file path")`
 */
export const zFilePath = z.string().min(1)
  .refine((p) => p.startsWith("/") || p.startsWith("~/") || p === "~",
    "File path must be absolute (use / or ~/)")
  .transform((p) =>
    p.startsWith("~/") ? `${HOME}${p.slice(1)}` : p === "~" ? HOME : p)
  .refine((p) => !/(^|\/)\.\.($|\/)/.test(p),
    "Path traversal is not allowed");
