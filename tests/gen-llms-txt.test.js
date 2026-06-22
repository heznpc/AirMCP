import { describe, test, expect, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTools, generateLlmsText } from "../scripts/gen-llms-txt.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("gen-llms-txt", () => {
  test("extracts concatenated string-literal descriptions without truncation", () => {
    const dir = mkdtempSync(join(tmpdir(), "airmcp-llms-"));
    tempDirs.push(dir);
    const source = join(dir, "tools.ts");
    writeFileSync(
      source,
      `
server.registerTool(
  "sample_tool",
  {
    title: "Sample Tool",
    description:
      "First sentence. " +
      "Second sentence.",
    inputSchema: {},
  },
  async () => {},
);
`,
    );

    expect(extractTools(source)).toEqual([
      {
        name: "sample_tool",
        title: "Sample Tool",
        description: "First sentence. Second sentence.",
      },
    ]);
  });

  test("keeps real permission caveats in llms-full output", () => {
    const { fullTxt } = generateLlmsText();

    expect(fullTxt).toContain("from an unentitled CLI caller it aborts with a permission error");
    expect(fullTxt).toContain("First use triggers a macOS permission dialog.");
  });
});
