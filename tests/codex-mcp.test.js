import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const originalCodexConfigPath = process.env.AIRMCP_CODEX_CONFIG_PATH;
const testHome = mkdtempSync(join(tmpdir(), "airmcp-codex-mcp-"));
process.env.HOME = testHome;
process.env.AIRMCP_CODEX_CONFIG_PATH = join(testHome, "config.toml");
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const packageSpecifier = `airmcp@${packageVersion}`;

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
        'AIRMCP_HTTP_TOKEN = "test-runtime-token"',
        "",
      ].join("\n"),
    );

    expect(codexAirmcpRuntimeShape()).toBe("app-owned-pending-restart");
  });

  test("treats a config.toml carrying a stale token as not-app-owned so it gets repaired", () => {
    // CLI output is stale-direct; config.toml has the app-owned proxy shape but
    // a token that no longer matches the live runtime token. The runtime path
    // must NOT report app-owned (which would suppress repair).
    codexGetOutput = ["airmcp", "  transport: stdio", "  command: npx", "  args: -y airmcp@2.12.0"].join("\n");
    writeFileSync(
      process.env.AIRMCP_CODEX_CONFIG_PATH,
      [
        "[mcp_servers.airmcp]",
        'command = "npx"',
        `args = ["-y", "airmcp", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
        "",
        "[mcp_servers.airmcp.env]",
        'AIRMCP_HTTP_TOKEN = "stale-old-token"',
        "",
      ].join("\n"),
    );

    expect(codexAirmcpRuntimeShape()).toBe("direct");
  });

  test("detects the inline-table env form of the app-owned proxy", () => {
    expect(
      codexConfigTomlRuntimeShape(
        [
          "[mcp_servers.airmcp]",
          'command = "npx"',
          `args = ["-y", "airmcp", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
          'env = { AIRMCP_HTTP_TOKEN = "token" }',
        ].join("\n"),
      ),
    ).toBe("app-owned");
  });

  test("compares the inline-table token value against the live token", () => {
    const toml = [
      "[mcp_servers.airmcp]",
      'command = "npx"',
      `args = ["-y", "airmcp", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
      'env = { AIRMCP_HTTP_TOKEN = "live-token" }',
    ].join("\n");
    expect(codexConfigTomlRuntimeShape(toml, "live-token")).toBe("app-owned");
    expect(codexConfigTomlRuntimeShape(toml, "different-token")).toBe("unknown");
  });

  test("parses Codex config.toml app-owned proxy shape", () => {
    expect(
      codexConfigTomlRuntimeShape(
        [
          "[mcp_servers.airmcp]",
          'command = "npx"',
          `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
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
        packageSpecifier,
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
      args: ["-y", packageSpecifier, "connect", "--url", CODEX_APP_OWNED_URL],
      env: { AIRMCP_HTTP_TOKEN: "test-token" },
    });
  });
});
