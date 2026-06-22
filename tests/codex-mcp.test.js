import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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
  configureCodexAirmcp,
  isCodexAirmcpConfigured,
  stdioProxyEntry,
} = await import("../dist/cli/codex-mcp.js");

let codexGetOutput;

beforeEach(() => {
  codexGetOutput = null;
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
