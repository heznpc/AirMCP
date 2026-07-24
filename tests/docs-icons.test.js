import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("documentation module icons", () => {
  test("injects the intelligence gradient before the closing SVG tag", () => {
    const source = readFileSync(join(ROOT, "docs", "icons.js"), "utf8");
    const context = {
      document: {
        addEventListener() {},
        querySelectorAll() {
          return [];
        },
      },
    };
    vm.runInNewContext(`${source}\n;globalThis.__modIcons = ModIcons;`, context);

    const svg = context.__modIcons.getSvg("intelligence");
    expect(svg).toContain('<linearGradient id="ai-grad"');
    expect(svg.indexOf("<defs>")).toBeGreaterThan(svg.indexOf("<svg "));
    expect(svg.indexOf("<defs>")).toBeLessThan(svg.indexOf("</svg>"));
    expect(svg.match(/<svg /g)).toHaveLength(1);
  });
});
