import { afterEach, describe, expect, test } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import {
  expectNoWireError,
  firstText,
  MCP_PROTOCOL_VERSION,
  parseStructuredResult,
  startMcp,
} from "../scripts/lib/mcp-stdio-client.mjs";

let tempDirs = [];

function makeChild(script) {
  const dir = mkdtempSync(join(tmpdir(), "airmcp-mcp-stdio-client-"));
  tempDirs.push(dir);
  const entry = join(dir, "child.mjs");
  writeFileSync(entry, script);
  return { dir, entry };
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("mcp stdio client helper", () => {
  test("production probes use the pinned SDK's latest supported stable revision", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(MCP_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(MCP_PROTOCOL_VERSION);
  });

  test("exchanges JSON-RPC requests and parses MCP tool results", async () => {
    const { dir, entry } = makeChild(`
      import { createInterface } from "node:readline";

      console.error("child-booted");
      const rl = createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.id === undefined) return;
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            structuredContent: { method: msg.method, params: msg.params },
            content: [{ type: "text", text: JSON.stringify({ fallback: true }) }]
          }
        }) + "\\n");
      });
    `);
    const client = startMcp({ entry, cwd: dir, env: process.env, timeoutMs: 1000, nodeBin: process.execPath });

    try {
      const resp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 1);

      expect(parseStructuredResult(resp)).toEqual({
        method: "tools/call",
        params: { name: "profile_status", arguments: {} },
      });
      expect(firstText(resp)).toBe(JSON.stringify({ fallback: true }));
      expect(() => expectNoWireError(resp, "tools/call")).not.toThrow();

      client.notify("notifications/initialized");
      expect(client.stderr()).toContain("child-booted");
    } finally {
      await client.stop();
    }
  });

  test("rejects requests that do not receive a response", async () => {
    const { dir, entry } = makeChild(`
      import { createInterface } from "node:readline";

      createInterface({ input: process.stdin }).on("line", () => {});
    `);
    const client = startMcp({ entry, cwd: dir, env: process.env, timeoutMs: 25, nodeBin: process.execPath });

    try {
      await expect(client.request("tools/list", {}, 7)).rejects.toThrow("timeout waiting for id=7");
    } finally {
      await client.stop();
    }
  });
});
