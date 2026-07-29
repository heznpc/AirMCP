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

describe("testing documentation", () => {
  test("uses current Jest and Zod guidance", () => {
    for (const { text } of readDocs()) {
      for (const stalePattern of STALE_PATTERNS) {
        expect(text).not.toContain(stalePattern);
      }

      expect(text).toContain("Zod 4");
    }
  });

  test("only names test files that exist", () => {
    for (const { path, text } of readDocs()) {
      const namedTestFiles = new Set(text.match(/tests\/[\w/-]+\.test\.js/g) ?? []);

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
