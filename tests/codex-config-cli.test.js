import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "../scripts/lib/clean-boot-env.mjs";

const DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const homes = [];

function runCli(home, args, cwd = home) {
  return spawnSync(process.execPath, [DIST, ...args], {
    cwd,
    env: { ...cleanBootEnv(), HOME: home, NO_COLOR: "1", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
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
