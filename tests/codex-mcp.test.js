import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const originalCodexConfigPath = process.env.AIRMCP_CODEX_CONFIG_PATH;
const testHome = mkdtempSync(join(tmpdir(), "airmcp-codex-mcp-"));
process.env.HOME = testHome;
process.env.AIRMCP_CODEX_CONFIG_PATH = join(testHome, "config.toml");

const execFileSync = jest.fn();
const ensureAppRuntimeToken = jest.fn(() => "test-runtime-token");

jest.unstable_mockModule("node:child_process", () => ({
  execFileSync,
}));

jest.unstable_mockModule("../dist/shared/app-runtime-token.js", () => ({
  ensureAppRuntimeToken,
}));

const {
  CODEX_APP_OWNED_URL,
  codexAirmcpRuntimeShape,
  codexConfigTomlRuntimeShape,
  configureCodexAirmcp,
  isCodexAirmcpConfigured,
  stdioProxyEntry,
} = await import("../dist/cli/codex-mcp.js");

let codexGetOutput;

beforeEach(() => {
  codexGetOutput = null;
  writeFileSync(process.env.AIRMCP_CODEX_CONFIG_PATH, "");
  execFileSync.mockReset();
  execFileSync.mockImplementation((_command, args) => {
    if (args[0] === "--version") return "codex 0.0.0";
    if (args.join(" ") === "mcp get airmcp") {
      if (codexGetOutput === null) throw new Error("missing");
      return codexGetOutput;
    }
    return "";
  });
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalCodexConfigPath === undefined) delete process.env.AIRMCP_CODEX_CONFIG_PATH;
  else process.env.AIRMCP_CODEX_CONFIG_PATH = originalCodexConfigPath;
  rmSync(testHome, { recursive: true, force: true });
});

describe("codex MCP setup", () => {
  test("classifies stale direct stdio config separately from app-owned runtime", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      "  args: -y airmcp@2.12.0",
    ].join("\n");

    expect(isCodexAirmcpConfigured()).toBe(true);
    expect(codexAirmcpRuntimeShape()).toBe("direct");
  });

  test("does not classify a bare HTTP URL as the recommended token-gated shape", () => {
    codexGetOutput = ["airmcp", "  enabled: true", "  transport: streamable-http", `  url: ${CODEX_APP_OWNED_URL}`].join(
      "\n",
    );

    expect(codexAirmcpRuntimeShape()).toBe("unknown");
  });

  test("classifies the token-gated proxy config as the recommended shape", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      "  args: -y airmcp connect --url http://127.0.0.1:3847/mcp",
      "  env: AIRMCP_HTTP_TOKEN=********",
    ].join("\n");

    expect(codexAirmcpRuntimeShape()).toBe("app-owned");
  });

  test("classifies config.toml app-owned entries as pending restart when CLI output is stale", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      "  args: -y airmcp@2.12.0",
    ].join("\n");
    writeFileSync(
      process.env.AIRMCP_CODEX_CONFIG_PATH,
      [
        "[mcp_servers.airmcp]",
        'command = "npx"',
        `args = ["-y", "/Users/ren/IdeaProjects/MCP/AirMCP", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
        "",
        "[mcp_servers.airmcp.env]",
        'AIRMCP_HTTP_TOKEN = "token"',
        "",
      ].join("\n"),
    );

    expect(codexAirmcpRuntimeShape()).toBe("app-owned-pending-restart");
  });

  test("parses Codex config.toml app-owned proxy shape", () => {
    expect(
      codexConfigTomlRuntimeShape(
        [
          "[mcp_servers.airmcp]",
          'command = "npx"',
          `args = ["-y", "airmcp@2.12.1", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
          "",
          "[mcp_servers.airmcp.env]",
          'AIRMCP_HTTP_TOKEN = "token"',
        ].join("\n"),
      ),
    ).toBe("app-owned");
  });

  test("replaces an existing Codex entry with the token-gated app-owned proxy", () => {
    codexGetOutput = "airmcp\n  transport: stdio\n  command: npx\n  args: -y airmcp";

    expect(configureCodexAirmcp()).toBe("configured");
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      ["mcp", "remove", "airmcp"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      [
        "mcp",
        "add",
        "--env",
        "AIRMCP_HTTP_TOKEN=test-runtime-token",
        "airmcp",
        "--",
        "npx",
        "-y",
        "airmcp@2.12.1",
        "connect",
        "--url",
        CODEX_APP_OWNED_URL,
      ],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  test("stdio clients use a token-gated proxy command rather than launching another server", () => {
    expect(stdioProxyEntry("test-token")).toEqual({
      command: "npx",
      args: ["-y", "airmcp@2.12.1", "connect", "--url", CODEX_APP_OWNED_URL],
      env: { AIRMCP_HTTP_TOKEN: "test-token" },
    });
  });
});
