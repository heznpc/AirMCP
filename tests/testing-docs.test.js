import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_PATHS = ["docs/testing.md", "docs/site/src/content/docs/contributing/testing.md"];
const STALE_PATTERNS = [["--testPathPattern", "="].join(""), ["~3", ".24.0"].join(""), ["3", ".25+"].join("")];

function readDocs() {
  return DOC_PATHS.map((path) => ({
    path,
    text: readFileSync(join(ROOT, path), "utf8"),
  }));
}

function extractNamedTestFiles(text) {
  const namedTestFiles = new Set(text.match(/tests\/[\w/-]+\.test\.js/g) ?? []);
  const testsTreeBlocks = (text.match(/```[\s\S]*?```/g) ?? []).filter((block) => /^tests\/\s*$/m.test(block));

  for (const block of testsTreeBlocks) {
    const bareTestFiles = block.match(/(?:^|\s|[├└]──\s*)([\w/-]+\.test\.js)\b/gm) ?? [];

    for (const bareTestFile of bareTestFiles) {
      const normalized = bareTestFile.match(/([\w/-]+\.test\.js)\b/)?.[1];

      if (normalized) {
        namedTestFiles.add(`tests/${normalized}`);
      }
    }
  }

  return [...namedTestFiles].sort();
}

describe("testing documentation", () => {
  test("uses current Jest and Zod guidance", () => {
    for (const { text } of readDocs()) {
      for (const stalePattern of STALE_PATTERNS) {
        expect(text).not.toContain(stalePattern);
      }

      expect(text).toContain("Zod 4");
    }
  });

  test("extracts explicit paths and bare tests tree entries", () => {
    expect(
      extractNamedTestFiles(`
Run one file with tests/scripts.test.js.

\`\`\`
tests/
  swift.test.js
├── calendar-scripts.test.js
└── nested/example.test.js
\`\`\`
`),
    ).toEqual([
      "tests/calendar-scripts.test.js",
      "tests/nested/example.test.js",
      "tests/scripts.test.js",
      "tests/swift.test.js",
    ]);
  });

  test("only names test files that exist", () => {
    for (const { path, text } of readDocs()) {
      const namedTestFiles = extractNamedTestFiles(text);

      for (const namedTestFile of namedTestFiles) {
        expect({
          doc: path,
          testFile: namedTestFile,
          exists: existsSync(join(ROOT, namedTestFile)),
        }).toMatchObject({ exists: true });
      }
    }
  });
});
