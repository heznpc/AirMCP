import { describe, expect, test, afterEach } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "summarize-audit.mjs");
const FIXTURES = join(ROOT, "tests", "fixtures", "audit");
const tempDirs = [];

function runSummarizeAudit(args = [], options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
    ...options,
  });
}

function createFailingNpmPath() {
  const dir = mkdtempSync(join(tmpdir(), "airmcp-audit-fixture-path-"));
  tempDirs.push(dir);
  const npmPath = join(dir, "npm");
  writeFileSync(npmPath, "#!/bin/sh\necho fixture mode must not run npm audit >&2\nexit 99\n");
  chmodSync(npmPath, 0o755);
  return dir;
}

function createRecordingNpmPath(logPath) {
  const dir = mkdtempSync(join(tmpdir(), "airmcp-audit-npm-path-"));
  tempDirs.push(dir);
  const npmPath = join(dir, "npm");
  writeFileSync(
    npmPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" > ${JSON.stringify(logPath)}`,
      "printf '%s\\n' '{\"metadata\":{\"vulnerabilities\":{\"total\":0}},\"vulnerabilities\":{}}'",
      "",
    ].join("\n"),
  );
  chmodSync(npmPath, 0o755);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("summarize-audit", () => {
  test("fixture mode reads a file without invoking npm audit", () => {
    const result = runSummarizeAudit([join(FIXTURES, "zero-findings.json")], {
      env: { ...process.env, PATH: createFailingNpmPath() },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No moderate+ advisories detected.");
  });

  test("reports zero findings from fixture data", () => {
    const result = runSummarizeAudit([join(FIXTURES, "zero-findings.json")]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("── summarize-audit — RFC 0003 Phase 1 ──");
    expect(result.stdout).toContain("total     0");
    expect(result.stdout).toContain("No moderate+ advisories detected.");
    expect(result.stdout).toContain("Hard gate: `npm audit --audit-level=high --omit=dev` (still blocking).");
  });

  test("reports mixed moderate and high findings with high severity first", () => {
    const result = runSummarizeAudit([join(FIXTURES, "mixed-findings.json")]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("moderate  1");
    expect(result.stdout).toContain("high      1");
    expect(result.stdout).toContain("total     2");
    expect(result.stdout).toContain("[high] vulnerable-high — High impact audit fixture");
    expect(result.stdout).toContain("[moderate] vulnerable-moderate — Moderate impact audit fixture");
    expect(result.stdout.indexOf("[high] vulnerable-high")).toBeLessThan(
      result.stdout.indexOf("[moderate] vulnerable-moderate"),
    );
  });

  test("limits moderate+ advisory details to the top five", () => {
    const result = runSummarizeAudit([join(FIXTURES, "more-than-five-findings.json")]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Top 5 advisories (moderate+):");
    expect(result.stdout).toContain("[critical] critical-one — Critical fixture advisory");
    expect(result.stdout).toContain("[high] high-one — High fixture advisory one");
    expect(result.stdout).toContain("[high] high-two — High fixture advisory two");
    expect(result.stdout).toContain("[moderate] moderate-one — Moderate fixture advisory one");
    expect(result.stdout).toContain("[moderate] moderate-two — Moderate fixture advisory two");
    expect(result.stdout).not.toContain("moderate-three");
    expect(result.stdout).toContain("…and 1 more.");
  });

  test("malformed fixture JSON warns and exits zero", () => {
    const result = runSummarizeAudit([join(FIXTURES, "malformed.json")]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::summarize-audit: could not parse npm audit JSON output");
    expect(result.stdout).toContain("{ this is not valid npm audit JSON");
  });

  test("no-argument mode still runs npm audit with the production dependency boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "airmcp-audit-args-"));
    tempDirs.push(dir);
    const logPath = join(dir, "args.txt");
    const result = runSummarizeAudit([], {
      env: { ...process.env, PATH: createRecordingNpmPath(logPath) },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No moderate+ advisories detected.");
    expect(readFileSync(logPath, "utf8").trim()).toBe("audit --json --audit-level=moderate --omit=dev");
  });
});
