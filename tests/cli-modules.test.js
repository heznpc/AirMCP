import { describe, test, expect } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function runModules(home, args) {
  return execFileSync(process.execPath, ["dist/index.js", "modules", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      AIRMCP_SEMANTIC_SEARCH: "false",
      AIRMCP_AUDIT_LOG: "false",
      AIRMCP_USAGE_TRACKING: "false",
      AIRMCP_PROACTIVE_CONTEXT: "false",
    },
    encoding: "utf8",
  });
}

function runModulesFailure(home, args, extraEnv = {}) {
  try {
    runModulesWithEnv(home, args, extraEnv);
    throw new Error("expected command to fail");
  } catch (error) {
    if (error.message === "expected command to fail") throw error;
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function runModulesWithEnv(home, args, extraEnv = {}) {
  return execFileSync(process.execPath, ["dist/index.js", "modules", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...extraEnv,
      HOME: home,
      AIRMCP_SEMANTIC_SEARCH: "false",
      AIRMCP_AUDIT_LOG: "false",
      AIRMCP_USAGE_TRACKING: "false",
      AIRMCP_PROACTIVE_CONTEXT: "false",
    },
    encoding: "utf8",
  });
}

describe("airmcp modules CLI", () => {
  test("lists active add-on package names without pack-* naming", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      const payload = JSON.parse(runModules(home, ["list", "--json"]));
      expect(payload.active).toContain("core");
      expect(payload.installPrefix).toBe(join(home, ".airmcp", "addons"));
      expect(payload.packs.some((pack) => pack.packageName.includes("pack-"))).toBe(false);
      expect(payload.packs.find((pack) => pack.name === "productivity").packageName).toBe(
        "@heznpc/airmcp-productivity",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("enable writes a narrow modulePacks config from an unconfigured install", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      const payload = JSON.parse(runModules(home, ["enable", "productivity", "--json"]));
      expect(payload.active).toEqual(["core", "productivity"]);

      const config = JSON.parse(readFileSync(join(home, ".config", "airmcp", "config.json"), "utf8"));
      expect(config.modulePacks).toEqual(["core", "productivity"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("enable --install dry-run plans companion package install before activation", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      const payload = JSON.parse(runModules(home, ["enable", "productivity", "--install", "--dry-run", "--json"]));
      expect(payload.plannedActive).toEqual(["core", "productivity"]);
      expect(payload.operation.action).toBe("install");
      expect(payload.operation.packages).toEqual([`@heznpc/airmcp-productivity@${pkg.version}`]);
      expect(payload.operation.command).toEqual(
        expect.arrayContaining(["npm", "install", "--no-save", `@heznpc/airmcp-productivity@${pkg.version}`]),
      );
      expect(existsSync(join(home, ".config", "airmcp", "config.json"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("uninstall dry-run plans companion package removal without disabling the pack", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      runModules(home, ["enable", "productivity", "--json"]);
      const payload = JSON.parse(runModules(home, ["uninstall", "productivity", "--dry-run", "--json"]));
      expect(payload.active).toEqual(["core", "productivity"]);
      expect(payload.plannedActive).toEqual(["core"]);
      expect(payload.operation.action).toBe("uninstall");
      expect(payload.operation.packages).toEqual(["@heznpc/airmcp-productivity"]);
      expect(payload.operation.command).toEqual(
        expect.arrayContaining(["npm", "uninstall", "@heznpc/airmcp-productivity"]),
      );

      const config = JSON.parse(readFileSync(join(home, ".config", "airmcp", "config.json"), "utf8"));
      expect(config.modulePacks).toEqual(["core", "productivity"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("disable never removes the required core pack", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      const payload = JSON.parse(runModules(home, ["disable", "all", "--json"]));
      expect(payload.active).toEqual(["core"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("rejects unknown module add-on names", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      const output = runModulesFailure(home, ["enable", "fakemodule"]);
      expect(output).toContain("Unknown module add-ons: fakemodule");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("does not edit config while AIRMCP_MODULE_PACKS overrides runtime state", () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-modules-"));
    try {
      const output = runModulesFailure(home, ["enable", "productivity"], { AIRMCP_MODULE_PACKS: "core-only" });
      expect(output).toContain("AIRMCP_MODULE_PACKS is set");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
