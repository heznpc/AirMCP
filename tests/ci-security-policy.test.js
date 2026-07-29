import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("CI dependency security policy", () => {
  test("the blocking audit matches RFC 0003's production dependency boundary", () => {
    const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain("npm audit --audit-level=high --omit=dev");
  });

  test("the moderate advisory uses the same production dependency boundary", () => {
    const script = readFileSync(join(root, "scripts/summarize-audit.mjs"), "utf8");

    expect(script).toContain('["audit", "--json", "--audit-level=moderate", "--omit=dev"]');
  });
});
