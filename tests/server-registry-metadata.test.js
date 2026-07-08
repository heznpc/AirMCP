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

  test("description keeps the stats sync anchor", () => {
    expect(serverJson.description).toMatch(/\d+ tools across \d+ modules/);
  });
});
