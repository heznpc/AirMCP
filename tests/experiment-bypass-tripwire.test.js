/**
 * Experiment-bypass tripwire.
 *
 * The ablation harness (separate, later PR) gets test-gated, EXPERIMENT-ONLY bypass
 * flags for the three hardcoded defenses (Safari egress guard, untrusted fencing /
 * taint, symlink-escape guard). This test makes sure that surface never leaks into
 * AirMCP's shipped product. It passes today (no harness exists) and FAILS the moment a
 * bypass is wired through a public surface: the env vars read by src/, the published
 * file set, a src/ experiment directory, the .mcpb builder, or product docs.
 *
 * Design ref: docs/experiments/harness-safety-preflight.md §1.
 */
import { describe, test, expect } from "@jest/globals";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Reserved env namespaces that must never appear on the public (src-read) surface.
const RESERVED_ENV = /AIRMCP_(EXPERIMENT|ABLATION|BYPASS|UNSAFE|DANGEROUS)_/;
// Disabling a *defense* (not a module/poller) via env is forbidden on the public surface.
const DEFENSE_DISABLE_ENV = /AIRMCP_DISABLE_(EGRESS|FENCE|FENCING|TAINT|SYMLINK|SSRF|GUARD|HITL|AUDIT)\b/;
// Experiment/harness paths must not ship or live under src/.
const EXP_PATH = /experiment|harness|ablation/i;
// Narrow, defense-context bypass phrase for docs (must NOT match benign "bypasses JXA").
const DEFENSE_BYPASS_PHRASE = /defense[-\s]?bypass|AIRMCP_(EXPERIMENT|ABLATION|BYPASS|UNSAFE|DANGEROUS)_/i;

function scanSrc() {
  const dirNames = [];
  let tsText = "";
  const stack = [join(ROOT, "src")];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        dirNames.push(e.name);
        stack.push(full);
      } else if (e.name.endsWith(".ts")) {
        tsText += readFileSync(full, "utf8") + "\n";
      }
    }
  }
  return { dirNames, tsText };
}

describe("experiment-bypass tripwire", () => {
  const { dirNames, tsText } = scanSrc();
  const envTokens = [...new Set(tsText.match(/AIRMCP_[A-Z0-9_]+/g) ?? [])];

  test("no reserved experiment/bypass env var is read by shipped src/", () => {
    const leaked = envTokens.filter((t) => RESERVED_ENV.test(t) || DEFENSE_DISABLE_ENV.test(t));
    expect(leaked).toEqual([]);
  });

  test("no experiment/harness/ablation directory lives under src/ (would compile into dist/)", () => {
    const leaked = dirNames.filter((n) => EXP_PATH.test(n));
    expect(leaked).toEqual([]);
  });

  test("package.json publishes no experiment path (files stays dist-only)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const files = pkg.files ?? [];
    expect(files).toContain("dist");
    expect(files.filter((f) => EXP_PATH.test(f))).toEqual([]);
  });

  test(".mcpb builder ships only dist/, not an experiment path", () => {
    const build = readFileSync(join(ROOT, "scripts", "build-mcpb.mjs"), "utf8");
    expect(build).toContain('cpSync(join(ROOT, "dist")');
    expect(EXP_PATH.test(build)).toBe(false);
  });

  test("product docs do not expose defense-bypass identifiers", () => {
    const productDocs = ["README.md", "llms.txt", "llms-full.txt", join("docs", "index.html")];
    for (const rel of productDocs) {
      const abs = join(ROOT, rel);
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, "utf8");
      expect(DEFENSE_BYPASS_PHRASE.test(text)).toBe(false);
      expect(DEFENSE_DISABLE_ENV.test(text)).toBe(false);
    }
  });
});
