import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  codexConfigTomlEnabledState,
  codexConfigTomlRuntimeShape,
  codexDirectManualSetupCommand,
  configureCodexAirmcp,
  configureCodexAirmcpDirect,
  directStdioEntry,
  inspectCodexAirmcpRegistration,
  isCodexAirmcpConfigured,
  resolveCodexConfigPath,
  setCodexAirmcpEnabled,
  stdioProxyEntry,
  updateCodexAirmcpEnabledInToml,
} = await import("../dist/cli/codex-mcp.js");

let codexGetOutput;
let codexGetJsonOutput;
let failReplacementAdd;
let failRestorationAdd;
let failRemoveAfterMutation;
let removeCalls;

beforeEach(() => {
  codexGetOutput = null;
  codexGetJsonOutput = {
    name: "airmcp",
    enabled: true,
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "airmcp@2.12.0"],
      env: null,
      env_vars: [],
      cwd: null,
    },
  };
  failReplacementAdd = false;
  failRestorationAdd = false;
  failRemoveAfterMutation = false;
  removeCalls = 0;
  writeFileSync(process.env.AIRMCP_CODEX_CONFIG_PATH, "");
  execFileSync.mockReset();
  execFileSync.mockImplementation((_command, args) => {
    if (args[0] === "--version") return "codex 0.0.0";
    if (args.join(" ") === "mcp get airmcp --json") {
      if (codexGetJsonOutput === null) throw new Error("snapshot missing");
      return JSON.stringify(codexGetJsonOutput);
    }
    if (args.join(" ") === "mcp get airmcp") {
      if (codexGetOutput === null) throw new Error("missing");
      return codexGetOutput;
    }
    if (args.join(" ") === "mcp remove airmcp") {
      removeCalls += 1;
      if (failRemoveAfterMutation && removeCalls === 1) {
        writeFileSync(process.env.AIRMCP_CODEX_CONFIG_PATH, '[mcp_servers.airmcp]\ncommand = "partial-remove"\n');
        throw new Error("remove failed after mutation");
      }
    }
    if (args[0] === "mcp" && args[1] === "add") {
      const isReplacement = args.includes(packageSpecifier);
      if (isReplacement && failReplacementAdd) {
        writeFileSync(process.env.AIRMCP_CODEX_CONFIG_PATH, '[mcp_servers.airmcp]\ncommand = "partial"\n');
        throw new Error("replacement add failed");
      }
      if (!isReplacement && failRestorationAdd) throw new Error("restoration add failed");
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
  test("resolves the user config with explicit path, CODEX_HOME, then HOME precedence", () => {
    expect(
      resolveCodexConfigPath({
        AIRMCP_CODEX_CONFIG_PATH: "/explicit/config.toml",
        CODEX_HOME: "/custom/codex",
        HOME: "/user/home",
      }),
    ).toBe("/explicit/config.toml");
    expect(resolveCodexConfigPath({ CODEX_HOME: "/custom/codex", HOME: "/user/home" })).toBe(
      "/custom/codex/config.toml",
    );
    expect(resolveCodexConfigPath({ HOME: "/user/home" })).toBe("/user/home/.codex/config.toml");
  });

  test("canonicalizes relative config roots before deriving the child Codex home", () => {
    expect(resolveCodexConfigPath({ AIRMCP_CODEX_CONFIG_PATH: "relative-codex/config.toml" })).toBe(
      resolve("relative-codex/config.toml"),
    );
    expect(resolveCodexConfigPath({ CODEX_HOME: "relative-codex-home" })).toBe(
      resolve("relative-codex-home/config.toml"),
    );
  });

  test("rejects an explicit filename that child Codex cannot address", () => {
    expect(() => resolveCodexConfigPath({ AIRMCP_CODEX_CONFIG_PATH: "/isolated/custom-codex.toml" })).toThrow(
      "AIRMCP_CODEX_CONFIG_PATH must name config.toml",
    );
  });

  test("captures one config directory for every child Codex call", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      `  args: -y ${packageSpecifier}`,
    ].join("\n");

    const selectedPath = process.env.AIRMCP_CODEX_CONFIG_PATH;
    process.env.AIRMCP_CODEX_CONFIG_PATH = join(testHome, "later-environment", "config.toml");
    try {
      expect(isCodexAirmcpConfigured()).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        "codex",
        ["mcp", "get", "airmcp"],
        expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: testHome }) }),
      );
    } finally {
      process.env.AIRMCP_CODEX_CONFIG_PATH = selectedPath;
    }
  });

  test("classifies stale direct stdio config separately from app-owned runtime", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      "  args: -y airmcp@2.12.0",
    ].join("\n");

    expect(isCodexAirmcpConfigured()).toBe(true);
    expect(codexAirmcpRuntimeShape()).toBe("unknown");
  });

  test("classifies only the exact current direct package specifier", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      `  args: -y ${packageSpecifier}`,
    ].join("\n");

    expect(codexAirmcpRuntimeShape()).toBe("direct");
  });

  test("rejects stale package specifiers in config.toml for direct and app-owned shapes", () => {
    expect(
      codexConfigTomlRuntimeShape(
        ["[mcp_servers.airmcp]", 'command = "npx"', 'args = ["-y", "airmcp@2.12.0"]'].join("\n"),
      ),
    ).toBe("unknown");
    expect(
      codexConfigTomlRuntimeShape(
        [
          "[mcp_servers.airmcp]",
          'command = "npx"',
          `args = ["-y", "airmcp@2.12.0", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
          "",
          "[mcp_servers.airmcp.env]",
          'AIRMCP_HTTP_TOKEN = "token"',
        ].join("\n"),
      ),
    ).toBe("unknown");
  });

  test("keeps external wrappers unknown while allowing persistent enable toggles", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: false",
      "  transport: stdio",
      "  command: /Users/test/.codex/bin/airmcp-connect.sh",
      "  args:",
    ].join("\n");
    writeFileSync(
      process.env.AIRMCP_CODEX_CONFIG_PATH,
      ["[mcp_servers.airmcp]", "enabled = false", 'command = "/Users/test/.codex/bin/airmcp-connect.sh"', ""].join(
        "\n",
      ),
    );

    expect(codexAirmcpRuntimeShape()).toBe("unknown");
    expect(setCodexAirmcpEnabled(true)).toEqual(expect.objectContaining({ globalState: "enabled", changed: true }));
  });

  test("does not classify a bare HTTP URL as the recommended token-gated shape", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: streamable-http",
      `  url: ${CODEX_APP_OWNED_URL}`,
    ].join("\n");

    expect(codexAirmcpRuntimeShape()).toBe("unknown");
  });

  test("classifies the token-gated proxy config as the recommended shape", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: stdio",
      "  command: npx",
      `  args: -y ${packageSpecifier} connect --url http://127.0.0.1:3847/mcp`,
      "  env: AIRMCP_HTTP_TOKEN=********",
    ].join("\n");

    expect(codexAirmcpRuntimeShape()).toBe("app-owned");
  });

  test("surfaces a disabled app-owned entry instead of reporting it as connected", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: false",
      "  transport: stdio",
      "  command: npx",
      `  args: -y ${packageSpecifier} connect --url http://127.0.0.1:3847/mcp`,
      "  env: AIRMCP_HTTP_TOKEN=********",
    ].join("\n");

    expect(codexAirmcpRuntimeShape()).toBe("app-owned-disabled");
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
        `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
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
        `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
        "",
        "[mcp_servers.airmcp.env]",
        'AIRMCP_HTTP_TOKEN = "stale-old-token"',
        "",
      ].join("\n"),
    );

    expect(codexAirmcpRuntimeShape()).toBe("unknown");
  });

  test("detects the inline-table env form of the app-owned proxy", () => {
    expect(
      codexConfigTomlRuntimeShape(
        [
          "[mcp_servers.airmcp]",
          'command = "npx"',
          `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
          'env = { AIRMCP_HTTP_TOKEN = "token" }',
        ].join("\n"),
      ),
    ).toBe("app-owned");
  });

  test("compares the inline-table token value against the live token", () => {
    const toml = [
      "[mcp_servers.airmcp]",
      'command = "npx"',
      `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
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

  test("parses disabled config.toml runtime shapes explicitly", () => {
    expect(
      codexConfigTomlRuntimeShape(
        [
          "[mcp_servers.airmcp]",
          "enabled = false",
          'command = "npx"',
          `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
          "",
          "[mcp_servers.airmcp.env]",
          'AIRMCP_HTTP_TOKEN = "token"',
        ].join("\n"),
      ),
    ).toBe("app-owned-disabled");
  });

  test("toggles only the AirMCP enabled key and preserves the rest of config.toml", () => {
    const original = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.airmcp] # managed entry",
      'command = "npx"',
      'args = ["-y", "airmcp"]',
      "",
      "[mcp_servers.airmcp.env]",
      'AIRMCP_HTTP_TOKEN = "keep-this-token"',
      "",
      '[projects."/tmp/example"]',
      'trust_level = "trusted"',
      "",
    ].join("\r\n");

    const disabled = updateCodexAirmcpEnabledInToml(original, false);
    expect(disabled.found).toBe(true);
    expect(disabled.changed).toBe(true);
    expect(codexConfigTomlEnabledState(disabled.toml)).toBe("disabled");
    expect(disabled.toml).toBe(
      original.replace(
        "[mcp_servers.airmcp] # managed entry\r\n",
        "[mcp_servers.airmcp] # managed entry\r\nenabled = false\r\n",
      ),
    );

    const enabled = updateCodexAirmcpEnabledInToml(disabled.toml, true);
    expect(enabled.toml).toBe(disabled.toml.replace("enabled = false", "enabled = true"));
    expect(codexConfigTomlEnabledState(enabled.toml)).toBe("enabled");
  });

  test("rejects malformed enabled values without rewriting the file", () => {
    const malformed = ["[mcp_servers.airmcp]", 'enabled = "sometimes"', 'command = "npx"'].join("\n");
    expect(codexConfigTomlEnabledState(malformed)).toBe("invalid");
    expect(() => updateCodexAirmcpEnabledInToml(malformed, false)).toThrow("invalid or duplicate");
  });

  test("atomically disables the global entry and reports a project override without editing it", () => {
    const project = join(testHome, "project");
    const projectConfig = join(project, ".codex", "config.toml");
    const globalConfig = process.env.AIRMCP_CODEX_CONFIG_PATH;
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(globalConfig, ['model = "gpt-5"', "[mcp_servers.airmcp]", 'command = "npx"', ""].join("\n"));
    writeFileSync(projectConfig, ["[mcp_servers.airmcp]", "enabled = true", 'command = "npx"', ""].join("\n"));
    const projectBefore = readFileSync(projectConfig, "utf8");

    const result = setCodexAirmcpEnabled(false, { projectDirectory: project });

    expect(result).toEqual(
      expect.objectContaining({
        globalState: "disabled",
        changed: true,
        projectOverride: { path: projectConfig, state: "enabled" },
      }),
    );
    expect(readFileSync(globalConfig, "utf8")).toContain("enabled = false");
    expect(readFileSync(globalConfig, "utf8")).toContain('model = "gpt-5"');
    expect(readFileSync(projectConfig, "utf8")).toBe(projectBefore);
    expect(inspectCodexAirmcpRegistration({ projectDirectory: project }).projectOverride).toEqual({
      path: projectConfig,
      state: "enabled",
    });
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

  test("restores the complete previous stdio config bytes and mode when replacement add fails", () => {
    const configPath = process.env.AIRMCP_CODEX_CONFIG_PATH;
    const original = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.airmcp]",
      "enabled = false",
      'command = "node"',
      'args = ["old-server.js"]',
      'cwd = "/tmp/old"',
      "startup_timeout_sec = 17",
      'enabled_tools = ["safe_tool"]',
      "",
      "[mcp_servers.airmcp.env]",
      'KEEP = "value"',
      "",
      "[mcp_servers.other]",
      'command = "keep-me"',
      "",
    ].join("\n");
    writeFileSync(configPath, original);
    chmodSync(configPath, 0o600);
    codexGetOutput = "airmcp\n  enabled: false\n  transport: stdio\n  command: node\n  args: old-server.js";
    codexGetJsonOutput = {
      name: "airmcp",
      enabled: false,
      transport: {
        type: "stdio",
        command: "node",
        args: ["old-server.js"],
        env: { KEEP: "value" },
        env_vars: [],
        cwd: "/tmp/old",
      },
      startup_timeout_sec: 17,
      enabled_tools: ["safe_tool"],
    };
    failReplacementAdd = true;

    expect(() => configureCodexAirmcp()).toThrow("previous stdio entry was restored");

    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      ["mcp", "get", "airmcp", "--json"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  test("restores the complete previous HTTP config when replacement add fails", () => {
    const configPath = process.env.AIRMCP_CODEX_CONFIG_PATH;
    const original = [
      "[mcp_servers.airmcp]",
      'url = "https://old.example.test/mcp"',
      'bearer_token_env_var = "OLD_TOKEN"',
      "tool_timeout_sec = 23",
      'http_headers = { "X-Safe" = "keep" }',
      "",
    ].join("\n");
    writeFileSync(configPath, original);
    codexGetOutput = [
      "airmcp",
      "  enabled: true",
      "  transport: streamable-http",
      "  url: https://old.example.test/mcp",
    ].join("\n");
    codexGetJsonOutput = {
      name: "airmcp",
      enabled: true,
      transport: {
        type: "streamable_http",
        url: "https://old.example.test/mcp",
        bearer_token_env_var: "OLD_TOKEN",
        http_headers: { "X-Safe": "keep" },
        env_http_headers: null,
      },
      tool_timeout_sec: 23,
    };
    failReplacementAdd = true;

    expect(() => configureCodexAirmcp()).toThrow("previous streamable_http entry was restored");
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  test("restores the complete config when remove mutates and then fails", () => {
    const configPath = process.env.AIRMCP_CODEX_CONFIG_PATH;
    const original = [
      'model = "gpt-5"',
      "[mcp_servers.airmcp]",
      'command = "node"',
      'args = ["old-server.js"]',
      "",
    ].join("\n");
    writeFileSync(configPath, original);
    codexGetOutput = "airmcp\n  transport: stdio\n  command: node\n  args: old-server.js";
    codexGetJsonOutput = {
      name: "airmcp",
      enabled: true,
      transport: { type: "stdio", command: "node", args: ["old-server.js"], env: null },
    };
    failRemoveAfterMutation = true;

    expect(() => configureCodexAirmcp()).toThrow("previous stdio entry was restored");
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(removeCalls).toBe(1);
  });

  test("reports replacement and restoration failure when no file snapshot is available", () => {
    codexGetOutput = "airmcp\n  transport: stdio\n  command: node\n  args: old-server.js";
    codexGetJsonOutput = {
      name: "airmcp",
      enabled: true,
      transport: { type: "stdio", command: "node", args: ["old-server.js"], env: null },
    };
    rmSync(process.env.AIRMCP_CODEX_CONFIG_PATH, { force: true });
    failReplacementAdd = true;
    failRestorationAdd = true;

    expect(() => configureCodexAirmcp()).toThrow("failed to restore the previous stdio entry");
  });

  test("explicitly disables and re-enables an existing app-owned entry without remove/add", () => {
    codexGetOutput = [
      "airmcp",
      "  enabled: false",
      "  transport: stdio",
      "  command: npx",
      `  args: -y ${packageSpecifier} connect --url http://127.0.0.1:3847/mcp`,
      "  env: AIRMCP_HTTP_TOKEN=********",
    ].join("\n");
    writeFileSync(
      process.env.AIRMCP_CODEX_CONFIG_PATH,
      [
        "[mcp_servers.airmcp]",
        "enabled = false",
        'command = "npx"',
        `args = ["-y", "${packageSpecifier}", "connect", "--url", "${CODEX_APP_OWNED_URL}"]`,
        "",
        "[mcp_servers.airmcp.env]",
        'AIRMCP_HTTP_TOKEN = "test-runtime-token"',
        "",
      ].join("\n"),
    );

    expect(configureCodexAirmcp()).toBe("configured");
    expect(readFileSync(process.env.AIRMCP_CODEX_CONFIG_PATH, "utf8")).toContain("enabled = true");
    expect(execFileSync).not.toHaveBeenCalledWith("codex", ["mcp", "remove", "airmcp"], expect.anything());

    codexGetOutput = codexGetOutput.replace("enabled: false", "enabled: true");
    expect(configureCodexAirmcp({ enabled: false })).toBe("configured");
    expect(readFileSync(process.env.AIRMCP_CODEX_CONFIG_PATH, "utf8")).toContain("enabled = false");
    expect(execFileSync).not.toHaveBeenCalledWith("codex", ["mcp", "add", "airmcp"], expect.anything());
  });

  test("stdio clients use a token-gated proxy command rather than launching another server", () => {
    expect(stdioProxyEntry("test-token")).toEqual({
      command: "npx",
      args: ["-y", packageSpecifier, "connect", "--url", CODEX_APP_OWNED_URL],
      env: { AIRMCP_HTTP_TOKEN: "test-token" },
    });
  });

  test("direct stdio entries intentionally launch the version-pinned server", () => {
    expect(directStdioEntry()).toEqual({
      command: "npx",
      args: ["-y", packageSpecifier],
    });
    expect(codexDirectManualSetupCommand()).toBe(`codex mcp add airmcp -- npx -y ${packageSpecifier}`);
  });

  test("can configure Codex for direct stdio runtime", () => {
    codexGetOutput = "airmcp\ntransport: http\ncommand: node";
    expect(configureCodexAirmcpDirect()).toBe("configured");
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      ["mcp", "remove", "airmcp"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "codex",
      ["mcp", "add", "airmcp", "--", "npx", "-y", packageSpecifier],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
});
