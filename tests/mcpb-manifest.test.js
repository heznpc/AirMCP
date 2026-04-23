// `.mcpb` (MCPB Desktop Extension) manifest template tests.
//
// The manifest is what Claude Desktop parses to show the extension in
// "Browse extensions" — a shape regression here breaks the install
// experience silently. Byte-level drift is caught by build:mcpb:check;
// these tests pin the schema expectations (spec v0.3) + substitution
// correctness.

import { describe, test, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(join(ROOT, "mcpb", "manifest.template.json"), "utf-8");

function render(version = "9.9.9", description = "Test description") {
  const rendered = template
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{DESCRIPTION}}", description.replace(/"/g, '\\"'));
  return JSON.parse(rendered);
}

describe("mcpb manifest template — MCPB v0.3 required fields", () => {
  test("manifest_version pinned to 0.3", () => {
    const m = render();
    // Bump intentionally when the spec version changes — forces a
    // review pass against the new required fields.
    expect(m.manifest_version).toBe("0.3");
  });

  test("name is MCPB-safe (lowercase alphanumerics + hyphens)", () => {
    const m = render();
    expect(m.name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(m.name).toBe("airmcp");
  });

  test("version substituted from {{VERSION}}", () => {
    expect(render("1.2.3").version).toBe("1.2.3");
    expect(render("2.11.0-rc.1").version).toBe("2.11.0-rc.1");
  });

  test("description substituted from {{DESCRIPTION}} with quote-escape", () => {
    expect(render("1.0.0", 'Say "hi"').description).toBe('Say "hi"');
  });

  test("author.name is required and non-empty", () => {
    const m = render();
    expect(m.author).toBeDefined();
    expect(typeof m.author.name).toBe("string");
    expect(m.author.name.length).toBeGreaterThan(0);
  });

  test("server config points at Node entry with __dirname-anchored args", () => {
    const m = render();
    expect(m.server.type).toBe("node");
    expect(m.server.entry_point).toBe("server/dist/index.js");
    expect(m.server.mcp_config.command).toBe("node");
    expect(m.server.mcp_config.args).toEqual(["${__dirname}/server/dist/index.js"]);
  });
});

describe("mcpb manifest template — user_config (MCPB-spec-aware)", () => {
  test("gemini_api_key is sensitive (masked input + secure storage)", () => {
    const m = render();
    const gk = m.user_config.gemini_api_key;
    expect(gk).toBeDefined();
    expect(gk.type).toBe("string");
    expect(gk.sensitive).toBe(true);
    expect(gk.required).toBe(false);
  });

  test("load_all_modules default matches AirMCP's starter-module stance", () => {
    const m = render();
    const la = m.user_config.load_all_modules;
    expect(la.type).toBe("boolean");
    expect(la.default).toBe(false);
    // If the default flips, the bundle starts loading 29 modules by
    // default — a footprint change that warrants re-audit + CHANGELOG
    // entry. Lock it here.
  });

  test("env substitutes user_config via MCPB ${user_config.KEY} syntax", () => {
    const m = render();
    expect(m.server.mcp_config.env.GEMINI_API_KEY).toBe("${user_config.gemini_api_key}");
    expect(m.server.mcp_config.env.AIRMCP_FULL).toBe("${user_config.load_all_modules}");
  });

  test("every referenced user_config key exists in user_config", () => {
    const m = render();
    const declared = new Set(Object.keys(m.user_config ?? {}));
    const env = m.server.mcp_config.env ?? {};
    for (const value of Object.values(env)) {
      const match = /\$\{user_config\.([^}]+)\}/.exec(value);
      if (!match) continue;
      expect(declared.has(match[1])).toBe(true);
    }
  });
});

describe("mcpb manifest template — compatibility pin", () => {
  test("platforms is darwin-only (AirMCP's Apple-native scope)", () => {
    const m = render();
    expect(m.compatibility.platforms).toEqual(["darwin"]);
  });

  test("Node runtime requirement stays in sync with package.json engines", () => {
    // Canary — if package.json bumps engines.node, the mcpb manifest
    // must be updated in lockstep or Claude Desktop will refuse to
    // install the bundle on older runtimes.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    const m = render();
    expect(m.compatibility.runtimes.node).toMatch(/^>=\d+\.\d+\.\d+$/);
    if (pkg.engines?.node) {
      // Extract the major version floor from each and compare.
      const pkgMajor = Number(/>=?(\d+)/.exec(pkg.engines.node)?.[1] ?? 0);
      const mcpbMajor = Number(/>=?(\d+)/.exec(m.compatibility.runtimes.node)?.[1] ?? 0);
      expect(mcpbMajor).toBe(pkgMajor);
    }
  });
});

describe("mcpb manifest template — tools_generated / prompts_generated", () => {
  test("both are true (AirMCP registers dynamically at runtime)", () => {
    const m = render();
    // AirMCP's tool surface includes dynamic shortcuts + skills, so the
    // MCPB installer cannot enumerate them at install time. These flags
    // tell Claude Desktop to treat the extension as having a runtime
    // discovery model.
    expect(m.tools_generated).toBe(true);
    expect(m.prompts_generated).toBe(true);
  });
});

describe("mcpb manifest template — well-formedness", () => {
  test("renders to valid JSON with no leftover template placeholders", () => {
    const rendered = template
      .replaceAll("{{VERSION}}", "1.0.0")
      .replaceAll("{{DESCRIPTION}}", "test");
    expect(rendered).not.toContain("{{");
    expect(() => JSON.parse(rendered)).not.toThrow();
  });

  test("every placeholder has a matching substitution in build-mcpb.mjs", () => {
    // Grab placeholders used in the template and confirm build-mcpb.mjs
    // substitutes each. Prevents a "template expects {{FOO}} but the
    // build script only replaces {{VERSION}}" drift.
    const placeholders = [...template.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
    const unique = [...new Set(placeholders)];
    const build = readFileSync(join(ROOT, "scripts", "build-mcpb.mjs"), "utf-8");
    for (const p of unique) {
      expect(build).toContain(`{{${p}}}`);
    }
  });

  test("privacy_policies entry is a stable URL", () => {
    const m = render();
    expect(Array.isArray(m.privacy_policies)).toBe(true);
    expect(m.privacy_policies[0]).toMatch(/^https:\/\//);
  });
});
