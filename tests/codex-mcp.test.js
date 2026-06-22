import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const execFileSync = jest.fn();

jest.unstable_mockModule("node:child_process", () => ({
  execFileSync,
}));

const {
  CODEX_APP_OWNED_URL,
  codexAirmcpRuntimeShape,
  configureCodexAirmcp,
  isCodexAirmcpConfigured,
  stdioProxyArgs,
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

  test("classifies the app-owned HTTP config as the recommended shape", () => {
    codexGetOutput = ["airmcp", "  enabled: true", "  transport: streamable-http", `  url: ${CODEX_APP_OWNED_URL}`].join(
      "\n",
    );

    expect(codexAirmcpRuntimeShape()).toBe("app-owned");
  });

  test("replaces an existing Codex entry with the app-owned HTTP URL", () => {
    codexGetOutput = "airmcp\n  transport: stdio\n  command: npx\n  args: -y airmcp";

    expect(configureCodexAirmcp()).toBe("configured");
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      ["mcp", "remove", "airmcp"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      ["mcp", "add", "airmcp", "--url", CODEX_APP_OWNED_URL],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  test("stdio clients use the proxy command rather than launching another server", () => {
    expect(stdioProxyArgs()).toEqual(["-y", "airmcp", "connect", "--url", CODEX_APP_OWNED_URL]);
  });
});
