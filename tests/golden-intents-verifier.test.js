import { describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("golden AppIntent verifier", () => {
  test("tracks the governed AppRuntimeClient call sites", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-golden-intents.mjs"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[golden] OK");
  });
});
