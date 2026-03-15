/**
 * Google Workspace CLI wrapper.
 *
 * Calls the `gws` binary (from @googleworkspace/cli) as a subprocess
 * and returns parsed JSON. Follows the same subprocess pattern as
 * src/shared/jxa.ts (JXA) and src/shared/swift.ts (Swift bridge).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { TIMEOUT, BUFFER } from "../shared/constants.js";

const execFileAsync = promisify(execFile);

const GWS_TIMEOUT = TIMEOUT.GWS;
const GWS_MAX_BUFFER = BUFFER.GWS;

/** Resolved path to gws binary — uses npx as fallback. */
let gwsBinary: string | null = null;

async function resolveGwsBinary(): Promise<string> {
  if (gwsBinary) return gwsBinary;

  // Try direct binary first
  try {
    await execFileAsync("gws", ["--version"], { timeout: TIMEOUT.CLI_PROBE });
    gwsBinary = "gws";
    return gwsBinary;
  } catch {
    // Fall back to npx
    gwsBinary = "npx";
    return gwsBinary;
  }
}

export interface GwsCallOptions {
  timeout?: number;
  pageAll?: boolean;
  pageLimit?: number;
}

/**
 * Execute a gws CLI command and return parsed JSON.
 *
 * @param service - e.g. "gmail", "drive", "sheets"
 * @param resource - e.g. "users", "files", "spreadsheets"
 * @param method - e.g. "list", "get", "create"
 * @param params - URL/query parameters
 * @param body - Request body (for POST/PATCH)
 * @param opts - Options (timeout, pagination)
 */
export async function runGws<T = unknown>(
  service: string,
  resource: string,
  method: string,
  params?: Record<string, unknown>,
  body?: Record<string, unknown>,
  opts?: GwsCallOptions,
): Promise<T> {
  const bin = await resolveGwsBinary();
  const args: string[] = [];

  // If using npx, prepend package reference
  if (bin === "npx") {
    args.push("-y", "@googleworkspace/cli");
  }

  args.push(service, resource, method);
  args.push("--format", "json");

  if (params && Object.keys(params).length > 0) {
    args.push("--params", JSON.stringify(params));
  }

  if (body && Object.keys(body).length > 0) {
    args.push("--json", JSON.stringify(body));
  }

  if (opts?.pageAll) {
    args.push("--page-all");
    if (opts.pageLimit) args.push("--page-limit", String(opts.pageLimit));
  }

  const timeout = opts?.timeout ?? GWS_TIMEOUT;

  const { stdout } = await execFileAsync(bin, args, {
    timeout,
    maxBuffer: GWS_MAX_BUFFER,
    env: { ...process.env },
  });

  // gws may return NDJSON (one JSON per line) with --page-all
  const trimmed = stdout.trim();
  if (!trimmed) return {} as T;

  // Try single JSON first
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // NDJSON: merge array results
    const lines = trimmed.split("\n").filter((l) => l.trim());
    const parsed = lines.map((l) => JSON.parse(l));
    return parsed as unknown as T;
  }
}

/**
 * Check if gws CLI is available and authenticated.
 * Returns null if OK, error message otherwise.
 */
export async function checkGws(): Promise<string | null> {
  try {
    const bin = await resolveGwsBinary();
    const args = bin === "npx" ? ["-y", "@googleworkspace/cli", "--version"] : ["--version"];
    await execFileAsync(bin, args, { timeout: 10_000 });
    return null;
  } catch (e) {
    return `gws CLI not available: ${e instanceof Error ? e.message : String(e)}`;
  }
}
