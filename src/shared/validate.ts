import { z } from "zod";

/**
 * Zod schema for file path parameters.
 * Validates absolute paths and blocks path traversal.
 * Usage: `path: zFilePath.describe("Absolute file path")`
 */
export const zFilePath = z.string().min(1)
  .refine((p) => p.startsWith("/") || p.startsWith("~"), "File path must be absolute")
  .refine((p) => !p.includes(".."), "Path traversal is not allowed");
