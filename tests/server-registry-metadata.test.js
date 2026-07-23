import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverJson = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf-8"));

describe("MCP registry server metadata", () => {
  test("description stays within the registry 100-character limit", () => {
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
  });

  test("description leads with discoverable identity and governance", () => {
    expect(serverJson.description).toMatch(/Apple MCP server/i);
    expect(serverJson.description).toMatch(/macOS/i);
    expect(serverJson.description).toMatch(/approval|audit/i);
    expect(serverJson.description).not.toMatch(/\d+\s+(?:tools?|modules?)/i);
  });
});
