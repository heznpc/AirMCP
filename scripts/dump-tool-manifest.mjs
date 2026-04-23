#!/usr/bin/env node
// RFC 0007 Phase A.0 — MCP tool manifest dumper.
//
// Boots the AirMCP stdio server the same way scripts/smoke-mcp.mjs does,
// performs the MCP 2025-06-18 handshake, asks for `tools/list`, and writes
// the normalized manifest to docs/tool-manifest.json (or --out).
//
// The manifest is the input to scripts/gen-swift-intents.mjs (which codegens
// Swift AppIntent structs in swift/Sources/AirMCPKit/Generated/MCPIntents.swift).
//
// Why capture via the wire protocol and not the internal ToolRegistry?
// (1) `tools/list` is already the MCP contract we publish externally, so a
//     drift between Node and Swift is detected against the same shape clients
//     see. (2) ToolRegistry currently stores only {name, title, description} —
//     inputSchema / outputSchema / annotations would need registry surgery to
//     expose. (3) Future Apple System MCP consumes `tools/list` too.
//
// Env knobs:
//   AIRMCP_MANIFEST_OUT    — output path (default: docs/tool-manifest.json)
//   MANIFEST_TIMEOUT_MS    — handshake + list timeout (default: 30_000)

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_PATH = process.env.AIRMCP_MANIFEST_OUT ?? join(ROOT, "docs", "tool-manifest.json");
const TIMEOUT_MS = Number(process.env.MANIFEST_TIMEOUT_MS ?? 30_000);

// --check flag: do not write; exit 1 if the on-disk file would differ.
const CHECK_ONLY = process.argv.includes("--check");

const entry = join(ROOT, "dist", "index.js");
if (!existsSync(entry)) {
  console.error(`[manifest] ${entry} not found — run \`npm run build\` first`);
  process.exit(2);
}

// Pin the manifest to a reproducible baseline so docs/tool-manifest.json
// is byte-stable across heterogeneous hosts and configs.
//
//   AIRMCP_FAKE_OS_VERSION=0   getOsVersion() returns 0 ("non-Darwin");
//                              OS-version tool gates (e.g. Safari
//                              add_bookmark skipped on macOS 26+) all see
//                              the same value regardless of host.
//   AIRMCP_FULL=true           load every module, not just STARTER_MODULES.
//                              Without this, a fresh machine (no
//                              ~/.airmcp/config.json) emits only the 7
//                              starter modules (~111 tools), while a
//                              developer laptop with a live config emits
//                              ~120+. The bridge codegen needs the full
//                              inventory regardless of user preference.
//   AIRMCP_COMPACT_TOOLS=false  Keep full tool descriptions. Compact mode
//                              (src/shared/tool-filter.ts) truncates to
//                              ~80 chars with "…" to save tokens in
//                              tools/list for LLM consumers, but Shortcuts
//                              / Siri / Spotlight render the description
//                              as user-facing UI, where truncation turns
//                              into e.g. "… Foundation Model and repo…".
//                              The manifest-driven Swift codegen wants
//                              the authored text verbatim.
//
// Do not set AIRMCP_TEST_MODE — that flag disables a separate set of
// paths (test helpers) unrelated to tool registration.
const server = spawn("node", [entry, "--full"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_FULL: "true",
    AIRMCP_COMPACT_TOOLS: "false",
    // Clear any per-module AIRMCP_DISABLE_* set in the developer shell
    // (belt-and-suspenders with --full).
    ...Object.fromEntries(
      Object.keys(process.env)
        .filter((k) => k.startsWith("AIRMCP_DISABLE_"))
        .map((k) => [k, ""]),
    ),
  },
});

const rl = createInterface({ input: server.stdout });
const pending = new Map();

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function request(method, params, id) {
  const payload = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
  server.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout id=${id} (${method})`));
      }
    }, TIMEOUT_MS);
  });
}

function notify(method) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

const watchdog = setTimeout(() => {
  console.error(`[manifest] overall timeout after ${TIMEOUT_MS}ms`);
  server.kill("SIGKILL");
  process.exit(2);
}, TIMEOUT_MS);

let exitCode = 0;
try {
  const initResp = await request(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "airmcp-manifest-dump", version: "0.0.0" },
    },
    1,
  );
  if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
  notify("notifications/initialized");

  const listResp = await request("tools/list", {}, 2);
  const tools = listResp.result?.tools;
  if (!Array.isArray(tools)) throw new Error(`tools/list malformed: ${JSON.stringify(listResp)}`);

  // Normalize: one entry per tool with only the fields codegen needs.
  // Sort by name for stable diff output.
  const normalized = tools
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name,
      title: t.title ?? t.annotations?.title ?? t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      outputSchema: t.outputSchema ?? null,
      annotations: {
        readOnlyHint: t.annotations?.readOnlyHint ?? false,
        destructiveHint: t.annotations?.destructiveHint ?? false,
        idempotentHint: t.annotations?.idempotentHint ?? false,
        openWorldHint: t.annotations?.openWorldHint ?? true,
      },
      // Eligibility gate for Swift AppIntent codegen (RFC 0007 §3.3).
      // Composite inputs (arrays of objects, records) can't map to @Parameter
      // today; we flag them so gen-swift-intents skips without breaking.
      // When ineligible we also record the specific reason so a future
      // WWDC update (e.g. AppIntent accepting struct params) or manifest
      // refactor can surface "here's what's missing" without re-deriving
      // from the schema. `null` when the tool is eligible.
      ...appIntentEligibility(t.inputSchema),
    }));

  const ineligibleCount = normalized.filter((t) => !t.appIntentEligible).length;
  const ineligibleByReason = {};
  for (const t of normalized) {
    if (t.appIntentEligible) continue;
    const reason = t.ineligibleReason ?? "unknown";
    ineligibleByReason[reason] = (ineligibleByReason[reason] ?? 0) + 1;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    protocolVersion: "2025-06-18",
    toolCount: normalized.length,
    eligibleCount: normalized.filter((t) => t.appIntentEligible).length,
    ineligibleCount,
    ineligibleByReason,
    tools: normalized,
  };

  const serialized = `${JSON.stringify(manifest, replacerStripGenerated, 2)}\n`;
  if (CHECK_ONLY) {
    const { readFileSync } = await import("node:fs");
    let existing = "";
    try {
      existing = readFileSync(OUT_PATH, "utf8");
    } catch {
      console.error(`[manifest --check] ${OUT_PATH} missing — run \`npm run gen:manifest\``);
      exitCode = 1;
    }
    if (existing && existing !== serialized) {
      console.error(`[manifest --check] drift detected in ${OUT_PATH} — run \`npm run gen:manifest\``);
      exitCode = 1;
    } else if (existing) {
      console.error(
        `[manifest --check] OK — ${manifest.toolCount} tools (${manifest.eligibleCount} AppIntent-eligible, ${manifest.ineligibleCount} ineligible${
          manifest.ineligibleCount > 0 ? ": " + Object.entries(manifest.ineligibleByReason).map(([r, n]) => `${r}=${n}`).join(", ") : ""
        })`,
      );
    }
  } else {
    writeFileSync(OUT_PATH, serialized);
    console.error(
      `[manifest] wrote ${OUT_PATH} — ${manifest.toolCount} tools (${manifest.eligibleCount} AppIntent-eligible, ${manifest.ineligibleCount} ineligible${
        manifest.ineligibleCount > 0 ? ": " + Object.entries(manifest.ineligibleByReason).map(([r, n]) => `${r}=${n}`).join(", ") : ""
      })`,
    );
  }
} catch (e) {
  console.error(`[manifest] FAIL — ${e instanceof Error ? e.message : String(e)}`);
  exitCode = 1;
} finally {
  clearTimeout(watchdog);
  server.kill("SIGTERM");
  setTimeout(() => {
    if (!server.killed) server.kill("SIGKILL");
    process.exit(exitCode);
  }, 2000).unref();
}

/**
 * Replacer that excludes `generatedAt` from the diffable payload.
 * The timestamp is embedded for humans reading the file, but the CI --check
 * path needs the rest to be byte-stable so a timestamp change alone doesn't
 * trip drift detection.
 */
function replacerStripGenerated(key, value) {
  if (key === "generatedAt") return "STABLE_PLACEHOLDER";
  return value;
}

/**
 * Decide whether the tool's inputSchema is expressible as a flat list of
 * AppIntent `@Parameter` properties, and if not, record why. RFC 0007
 * §3.3 table.
 *
 * Returns `{ appIntentEligible: true, ineligibleReason: null }` when
 * eligible, or `{ appIntentEligible: false, ineligibleReason: "..." }`
 * with a specific code:
 *   - "record-input"       additionalProperties: true (keys unknown)
 *   - "object-param:<key>" a property is `type: object` (composite)
 *   - "array-of-object:<k>" a property is `array<object>` (composite items)
 *
 * The reason code lands in the manifest so diagnostic tools can group
 * ineligibles by cause and so a future WWDC that lifts one constraint
 * can target a specific code to rerun codegen against.
 */
function appIntentEligibility(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object") {
    return { appIntentEligible: true, ineligibleReason: null };
  }
  if (inputSchema.additionalProperties === true) {
    return { appIntentEligible: false, ineligibleReason: "record-input" };
  }
  const props = inputSchema.properties ?? {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (!p || typeof p !== "object") continue;
    if (p.type === "object") {
      return { appIntentEligible: false, ineligibleReason: `object-param:${key}` };
    }
    if (p.type === "array" && p.items && typeof p.items === "object" && p.items.type === "object") {
      return { appIntentEligible: false, ineligibleReason: `array-of-object:${key}` };
    }
  }
  return { appIntentEligible: true, ineligibleReason: null };
}
