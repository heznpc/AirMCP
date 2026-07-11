import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "../scripts/lib/clean-boot-env.mjs";

const DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const homes = [];

function runCli(home, args, cwd = home, env = {}) {
  return spawnSync(process.execPath, [DIST, ...args], {
    cwd,
    env: { ...cleanBootEnv(), HOME: home, NO_COLOR: "1", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ...env },
    encoding: "utf8",
  });
}

function createHome() {
  const home = mkdtempSync(join(tmpdir(), "airmcp-codex-config-"));
  homes.push(home);
  mkdirSync(join(home, ".codex"), { recursive: true });
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("airmcp codex", () => {
  test("an invalid Codex override does not block help or config-only init", () => {
    const home = createHome();
    const invalidOverride = join(home, "custom-codex.toml");

    const help = runCli(home, ["codex", "--help"], home, {
      AIRMCP_CODEX_CONFIG_PATH: invalidOverride,
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: npx airmcp codex");

    const airmcpConfigPath = join(home, ".config", "airmcp", "config.json");
    const initialized = runCli(home, ["init", "--profile", "starter", "--yes"], home, {
      AIRMCP_CODEX_CONFIG_PATH: invalidOverride,
      AIRMCP_CONFIG_PATH: airmcpConfigPath,
    });
    expect(initialized.status).toBe(0);
    expect(initialized.stdout).toContain("clients=skipped");
    expect(existsSync(airmcpConfigPath)).toBe(true);
    expect(existsSync(invalidOverride)).toBe(false);
  });

  test("canonicalizes a relative explicit config before reporting and toggling it", () => {
    const home = createHome();
    const relativeRoot = "relative-codex";
    const configPath = join(realpathSync(home), relativeRoot, "config.toml");
    mkdirSync(join(home, relativeRoot), { recursive: true });
    writeFileSync(configPath, ["[mcp_servers.airmcp]", "enabled = true", 'command = "npx"', ""].join("\n"));

    const status = runCli(home, ["codex", "status", "--json"], home, {
      AIRMCP_CODEX_CONFIG_PATH: join(relativeRoot, "config.toml"),
    });
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(expect.objectContaining({ globalConfigPath: configPath }));

    const disabled = runCli(home, ["codex", "disable", "--json"], home, {
      AIRMCP_CODEX_CONFIG_PATH: join(relativeRoot, "config.toml"),
    });
    expect(disabled.status).toBe(0);
    expect(readFileSync(configPath, "utf8")).toContain("enabled = false");
  });

  test("fails closed before touching either file when an explicit filename cannot map to CODEX_HOME", () => {
    const home = createHome();
    const explicitPath = join(home, "custom-codex.toml");
    const childCodexPath = join(home, "config.toml");
    const explicitBefore = '[mcp_servers.airmcp]\ncommand = "explicit-must-stay"\n';
    const childBefore = '[mcp_servers.airmcp]\ncommand = "child-must-stay"\n';
    writeFileSync(explicitPath, explicitBefore);
    writeFileSync(childCodexPath, childBefore);

    const result = runCli(home, ["codex", "disable", "--json"], home, {
      AIRMCP_CODEX_CONFIG_PATH: explicitPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("AIRMCP_CODEX_CONFIG_PATH must name config.toml");
    expect(readFileSync(explicitPath, "utf8")).toBe(explicitBefore);
    expect(readFileSync(childCodexPath, "utf8")).toBe(childBefore);
  });

  test("uses CODEX_HOME for status and toggles without touching the default user config", () => {
    const home = createHome();
    const codexHome = join(home, "isolated-codex");
    const customConfigPath = join(codexHome, "config.toml");
    const defaultConfigPath = join(home, ".codex", "config.toml");
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(defaultConfigPath, 'model = "default-must-stay"\n');
    writeFileSync(
      customConfigPath,
      ["[mcp_servers.airmcp]", "enabled = true", 'command = "npx"', 'args = ["-y", "airmcp@2.16.0"]', ""].join("\n"),
    );

    const status = runCli(home, ["codex", "status", "--json"], home, { CODEX_HOME: codexHome });
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(
      expect.objectContaining({ globalState: "enabled", globalConfigPath: customConfigPath }),
    );

    const disabled = runCli(home, ["codex", "disable", "--json"], home, { CODEX_HOME: codexHome });
    expect(disabled.status).toBe(0);
    expect(readFileSync(customConfigPath, "utf8")).toContain("enabled = false");

    const enabled = runCli(home, ["codex", "enable", "--json"], home, { CODEX_HOME: codexHome });
    expect(enabled.status).toBe(0);
    expect(readFileSync(customConfigPath, "utf8")).toContain("enabled = true");
    expect(readFileSync(defaultConfigPath, "utf8")).toBe('model = "default-must-stay"\n');
  });

  test("disables and re-enables the persistent entry without deleting its settings", () => {
    const home = createHome();
    const configPath = join(home, ".codex", "config.toml");
    writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.airmcp]",
        'command = "npx"',
        'args = ["-y", "airmcp@2.16.0"]',
        "",
        "[mcp_servers.other]",
        'command = "other"',
        "",
      ].join("\n"),
    );

    const disabled = runCli(home, ["codex", "disable", "--json"]);
    expect(disabled.status).toBe(0);
    expect(JSON.parse(disabled.stdout)).toEqual(
      expect.objectContaining({ action: "disable", globalState: "disabled", changed: true }),
    );
    expect(readFileSync(configPath, "utf8")).toContain("enabled = false");
    expect(readFileSync(configPath, "utf8")).toContain("[mcp_servers.other]");

    const enabled = runCli(home, ["codex", "enable", "--json"]);
    expect(enabled.status).toBe(0);
    expect(JSON.parse(enabled.stdout)).toEqual(
      expect.objectContaining({ action: "enable", globalState: "enabled", changed: true }),
    );
    expect(readFileSync(configPath, "utf8")).toContain("enabled = true");
    expect(readFileSync(configPath, "utf8")).toContain('args = ["-y", "airmcp@2.16.0"]');
  });

  test("reports project precedence and leaves the project-local override untouched", () => {
    const home = createHome();
    const project = join(home, "project");
    const globalConfigPath = join(home, ".codex", "config.toml");
    const projectConfigPath = join(project, ".codex", "config.toml");
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(globalConfigPath, ["[mcp_servers.airmcp]", "enabled = true", 'command = "npx"', ""].join("\n"));
    writeFileSync(projectConfigPath, ["[mcp_servers.airmcp]", "enabled = true", 'command = "local"', ""].join("\n"));
    const projectBefore = readFileSync(projectConfigPath, "utf8");

    const result = runCli(home, ["codex", "disable", "--json"], project);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        globalState: "disabled",
        projectOverride: { path: join(realpathSync(project), ".codex", "config.toml"), state: "enabled" },
      }),
    );
    expect(readFileSync(projectConfigPath, "utf8")).toBe(projectBefore);
  });

  test("status reports an absent global registration without mutating config", () => {
    const home = createHome();
    const configPath = join(home, ".codex", "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    const result = runCli(home, ["codex", "status", "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({ action: "status", globalState: "missing", globalConfigPath: configPath }),
    );
    expect(readFileSync(configPath, "utf8")).toBe('model = "gpt-5"\n');
  });
});
