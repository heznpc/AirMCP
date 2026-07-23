import { describe, expect, test } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const aggregateCount = /\b\d+\s+(?:tools?|modules?)\b/i;
const visibleText = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("public positioning surfaces", () => {
  test("README discovery copy leads with the governed Apple MCP server, not catalog size", () => {
    const intro = read("README.md").split("## What You Get")[0];

    expect(intro).toMatch(/Apple MCP server for macOS/);
    expect(intro).toMatch(/governed local action runtime/i);
    expect(intro).toMatch(/Notes.*Mail.*Calendar.*Reminders.*Shortcuts/s);
    expect(intro).not.toMatch(aggregateCount);
  });

  test("landing metadata and above-the-fold copy are search-oriented and count-free", () => {
    const page = read("docs/index.html");
    const head = page.split("</head>")[0];
    const aboveFold = visibleText(page.split("<!-- Hero -->")[1]?.split("<!-- Modules -->")[0] ?? "");

    expect(head).toMatch(/Apple MCP Server for macOS/);
    expect(head).toMatch(/Apple-native MCP server for macOS/);
    expect(head).toMatch(/Notes, Mail, Calendar, Reminders, Shortcuts/);
    expect(head).not.toMatch(aggregateCount);

    expect(aboveFold).toMatch(/Governed access to your Apple workspace/);
    expect(aboveFold).toMatch(/Claude, Codex, Cursor/);
    expect(aboveFold).toMatch(/Per-call approval/);
    expect(aboveFold).toMatch(/Audit chain/);
    expect(aboveFold).not.toMatch(aggregateCount);
  });

  test("documentation and npm entry points use the same discovery position", () => {
    const docsHome = read("docs/site/src/content/docs/index.mdx").split("## Quick Start")[0];
    const packageMetadata = JSON.parse(read("package.json"));
    const packageDescription = packageMetadata.description;

    for (const copy of [docsHome, packageDescription]) {
      expect(copy).toMatch(/Apple(?:-native)? MCP server/i);
      expect(copy).toMatch(/macOS/i);
      expect(copy).not.toMatch(aggregateCount);
    }
    expect(packageDescription).toMatch(/Notes, Mail, Calendar, Reminders, Shortcuts/);
    expect(packageMetadata.keywords).toEqual(expect.arrayContaining(["mcp-server", "apple-mcp", "macos-automation"]));
  });

  test("localized marquee copy carries no numeric catalog pitch", () => {
    const marqueeKeys = [
      "meta_title",
      "meta_description",
      "hero_tagline",
      "hero_sub",
      "why_title",
      "why_1_title",
      "why_1_desc",
      "tryit_footer",
    ];
    const localeDir = join(ROOT, "docs", "locales");

    for (const file of readdirSync(localeDir).filter((name) => name.endsWith(".json"))) {
      const locale = JSON.parse(readFileSync(join(localeDir, file), "utf8"));
      const marquee = marqueeKeys.map((key) => locale[key]).join(" ");
      expect(marquee).toMatch(/AirMCP|Apple/);
      expect(marquee).not.toMatch(/\d/);
    }
  });

  test("llms summary opens with identity and governance, not catalog size", () => {
    const intro = read("llms.txt").split("## Links")[0];

    expect(intro).toMatch(/Apple-native MCP server for macOS/);
    expect(intro).toMatch(/governed connector and control layer/);
    expect(intro).toMatch(/not another agent/);
    expect(intro).not.toMatch(aggregateCount);
  });

  test("registry and package pitches are discoverable and count-free", () => {
    const server = JSON.parse(read("server.json"));
    const descriptions = [
      server.description,
      JSON.parse(read("mcp.json")).mcpServers.airmcp.description,
      JSON.parse(read("glama.json")).description,
      JSON.parse(read(".claude-plugin/plugin.json")).description,
      JSON.parse(read("mcpb/manifest.template.json")).long_description,
      read("smithery.yaml").match(/^description:\s*(.+)$/m)?.[1] ?? "",
    ];

    for (const description of descriptions) {
      expect(description).toMatch(/Apple/i);
      expect(description).toMatch(/MCP/);
      expect(description).toMatch(/macOS/i);
      expect(description).not.toMatch(aggregateCount);
    }
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  test("stats sync cannot repopulate count-led public descriptions", () => {
    const statsSync = read("scripts/count-stats.mjs");
    const forbiddenSyncTargets = [
      "docs/index.html",
      "docs/site/src/content/docs/index.mdx",
      "docs/locales/",
      "server.json",
      "mcp.json",
      "glama.json",
      "smithery.yaml",
      ".claude-plugin/plugin.json",
    ];

    for (const target of forbiddenSyncTargets) {
      expect(statsSync).not.toContain(`syncFile(\"${target}`);
    }
  });
});
