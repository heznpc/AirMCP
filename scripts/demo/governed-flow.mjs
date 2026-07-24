#!/usr/bin/env node
/**
 * governed-flow.mjs — the honest governance demo.
 *
 * Drives the REAL built server over stdio (no mocks, no fabrication) and prints
 * the "governed runtime, not an agent" story a connecting client actually sees:
 *
 *   1. initialize  → the identity AirMCP asserts into every client's context
 *   2. airmcp://trust → the live, falsifiable `governed` verdict
 *   3. preview_action(delete_reminder) → a destructive call previewed with a
 *      structural zero-side-effect guarantee (handler never invoked)
 *   4. audit_summary → tamper-evident verdict + provenance (byActor)
 *
 * Runs against a throwaway audit dir so it never touches ~/.airmcp. This is the
 * source of `docs/demo.gif` (recorded from the VHS tape); the output here is
 * real terminal output, not a staged transcript.
 *
 * Usage:  node scripts/demo/governed-flow.mjs   (requires `npm run build` first)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(ROOT, "dist", "index.js");

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const line = (label, value) => console.log(`  ${dim(label.padEnd(22))} ${value}`);

// Honest, key-grade-aware colouring: `governed:true` alone hides whether the
// chain is backed by an operator key or a re-derivable host-fallback key.
const paintAssurance = (a) =>
  a === "operator-attested"
    ? green(a)
    : a === "tamper-evident"
      ? yellow(a + dim(" (host-fallback key — set AIRMCP_AUDIT_HMAC_KEY for non-repudiation)"))
      : red(a);

const auditDir = mkdtempSync(join(tmpdir(), "airmcp-demo-"));
const child = spawn("node", [DIST], {
  stdio: ["pipe", "pipe", "ignore"],
  env: { ...process.env, AIRMCP_VECTOR_STORE_DIR: auditDir, AIRMCP_AUDIT_HMAC_KEY: "demo-operator-key" },
});

let buf = "";
const pending = new Map();
const rpc = (id, method, params) =>
  new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!l.trim()) continue;
    let m;
    try {
      m = JSON.parse(l);
    } catch {
      continue;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log(bold("\nAirMCP — governed runtime for the Apple ecosystem, not an agent\n"));

  const init = await rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "demo", version: "0" },
  });
  console.log(cyan("→ initialize") + dim("  — identity asserted into the client's context:"));
  console.log("  " + dim('"') + (init.result.instructions || "").slice(0, 96) + dim(' …"'));
  await sleep(200);

  const trust = JSON.parse((await rpc(2, "resources/read", { uri: "airmcp://trust" })).result.contents[0].text);
  console.log("\n" + cyan("→ read airmcp://trust") + dim("  — the live, falsifiable verdict:"));
  line("governed", trust.governed ? green("true") : yellow("false"));
  line("assurance", paintAssurance(trust.assurance));
  line("audit verified", trust.audit.verified ? green("true") : yellow("false"));
  line("approval level", trust.approval.level);
  line("emergency stop", trust.rateLimit.emergencyStop ? yellow("engaged") : "off");
  await sleep(200);

  const pv = (await rpc(3, "tools/call", {
    name: "preview_action",
    arguments: { tool: "delete_reminder", args: { id: "REM-8f2a" } },
  })).result.structuredContent;
  console.log("\n" + cyan("→ preview_action delete_reminder") + dim("  — dry-run, nothing executed:"));
  line("destructive", pv.annotations.destructive ? yellow("true") : "false");
  line("would need approval", pv.wouldRequireApproval ? green("true") : "false");
  line("required scope", pv.requiredScope);
  line("side effect", green(pv.sideEffect));
  await sleep(200);

  const sum = (await rpc(4, "tools/call", {
    name: "audit_summary",
    arguments: { since: "2020-01-01T00:00:00Z" },
  })).result.structuredContent;
  console.log("\n" + cyan("→ audit_summary") + dim("  — tamper-evident, with provenance:"));
  line("chain verified", sum.verified ? green("true") : yellow("false"));
  line(
    "byActor",
    sum.byActor.map((a) => `${a.actor}×${a.count}`).join(", ") || "(none yet)",
  );

  console.log(
    "\n" + dim("Every action mediated, approvable, auditable — verify it yourself: ") + bold("read airmcp://trust") + "\n",
  );
} finally {
  child.kill();
  // Let the server flush + release the audit dir before removing it, else a
  // last buffered write races rmSync into ENOTEMPTY.
  await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
  rmSync(auditDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
}
