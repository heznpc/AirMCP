import { describe, test, expect } from "@jest/globals";
import vm from "node:vm";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  searchFilesScript,
  getFileInfoScript,
  setTagsScript,
  recentFilesScript,
  listDirectoryScript,
} from "../dist/finder/scripts.js";

function executeFinderScript(script, shellOutput = "", context = {}) {
  const commands = [];
  function Application() {}
  Application.currentApplication = () => ({
    doShellScript(command) {
      commands.push(command);
      return shellOutput;
    },
  });
  const result = vm.runInNewContext(script, { Application, ...context });
  return { commands, result: JSON.parse(result) };
}

function runShell(command, prelude) {
  return spawnSync("/bin/sh", ["-c", `${prelude}\n${command}`], { encoding: "utf8" });
}

function executeFinderScriptWithShell(script, prelude, statOutput = "") {
  const commands = [];
  function Application() {}
  Application.currentApplication = () => ({
    doShellScript(command) {
      commands.push(command);
      if (command.startsWith("stat ")) return statOutput;
      const shell = runShell(command, prelude);
      if (shell.status !== 0) {
        throw new Error(`shell exited ${shell.status}: ${shell.stderr}`);
      }
      return shell.stdout.replace(/\n$/, "");
    },
  });
  const result = vm.runInNewContext(script, { Application });
  return { commands, result: JSON.parse(result) };
}

describe("finder script generators", () => {
  test("searchFilesScript uses mdfind", () => {
    const script = searchFilesScript("~", "report", 50);
    expect(script).toContain("mdfind");
    expect(script).toContain("report");
    expect(script).toContain("50");
  });

  test("getFileInfoScript reads metadata", () => {
    const script = getFileInfoScript("/Users/test/file.txt");
    expect(script).toContain("/Users/test/file.txt");
    expect(script).toContain("kMDItemUserTags");
    expect(script).toContain("item.size()");
  });

  test("setTagsScript sets tags via NSURL", () => {
    const script = setTagsScript("/Users/test/file.txt", ["Important", "Work"]);
    expect(script).toContain("NSURLTagNamesKey");
    expect(script).toContain("'Important'");
    expect(script).toContain("'Work'");
  });

  test("recentFilesScript passes Spotlight $time syntax to the shell without variable expansion", () => {
    class FixedDate extends Date {
      static now() {
        return Date.parse("2026-09-01T12:00:00.000Z");
      }
    }
    const script = recentFilesScript("/tmp", 7, 30);
    const { commands, result } = executeFinderScript(script, "/tmp/recent one.txt\n/tmp/recent-two.txt", {
      Date: FixedDate,
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('mdfind -onlyin "/tmp" "kMDItemContentModificationDate >= \\$time.iso(2026-08-25)"');
    expect(commands[0]).not.toContain("| head");

    // Run the generated command through a real shell with a fake mdfind
    // function. A non-escaped token would arrive as EXPANDED.iso(...).
    const forwardedArgs = execFileSync("/bin/sh", ["-c", `mdfind() { printf '%s\\n' "$@"; }; ${commands[0]}`], {
      encoding: "utf8",
      env: { ...process.env, time: "EXPANDED" },
    })
      .trim()
      .split("\n");
    expect(forwardedArgs).toHaveLength(3);
    expect(forwardedArgs[0]).toBe("-onlyin");
    expect(forwardedArgs[1]).toBe("/tmp");
    expect(forwardedArgs[2]).toBe("kMDItemContentModificationDate >= $time.iso(2026-08-25)");
    expect(forwardedArgs[2]).not.toContain("EXPANDED");

    expect(result).toEqual({
      total: 2,
      files: [
        { path: "/tmp/recent one.txt", name: "recent one.txt" },
        { path: "/tmp/recent-two.txt", name: "recent-two.txt" },
      ],
    });
  });

  test.each([
    ["searchFilesScript", "mdfind", () => searchFilesScript("/tmp", "report", 2)],
    ["recentFilesScript", "mdfind", () => recentFilesScript("/tmp", 7, 2)],
    ["listDirectoryScript", "ls", () => listDirectoryScript("/tmp", 2)],
  ])("%s preserves a failing producer exit status", (_name, producer, buildScript) => {
    const { commands } = executeFinderScript(buildScript());
    const shell = runShell(commands[0], `${producer}() { printf 'partial\\n'; return 17; }`);

    expect(shell.status).toBe(17);
    expect(shell.stdout).toBe("");
  });

  test.each([
    ["searchFilesScript", "mdfind", (path) => searchFilesScript(path, "report", 2)],
    ["recentFilesScript", "mdfind", (path) => recentFilesScript(path, 7, 2)],
    ["listDirectoryScript", "ls", (path) => listDirectoryScript(path, 2)],
  ])("%s rejects missing and non-directory roots", (_name, producer, buildScript) => {
    for (const path of ["/dev/null/airmcp-missing", "/dev/null"]) {
      expect(() => executeFinderScriptWithShell(buildScript(path), `${producer}() { :; }`)).toThrow(/shell exited 1/);
    }
  });

  test.each([
    ["searchFilesScript", "mdfind", (path) => searchFilesScript(path, "report", 2), { total: 0, files: [] }],
    ["recentFilesScript", "mdfind", (path) => recentFilesScript(path, 7, 2), { total: 0, files: [] }],
    ["listDirectoryScript", "ls", (path) => listDirectoryScript(path, 2), { total: 0, returned: 0, items: [] }],
  ])("%s accepts an existing empty directory", (_name, producer, buildScript, expected) => {
    const directory = mkdtempSync(join(tmpdir(), "airmcp-finder-test-"));
    try {
      const execution = executeFinderScriptWithShell(buildScript(directory), `${producer}() { :; }`);
      expect(execution.result).toEqual(expected);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  test("checked producer commands retain limits and JXA result mapping", () => {
    const mdfind = `mdfind() { printf '%s\\n' '/tmp/one file.txt' '/tmp/two.txt' '/tmp/three.txt'; }`;
    const search = executeFinderScriptWithShell(searchFilesScript("/tmp", "report", 2), mdfind, "10 0");
    expect(search.result).toEqual({
      total: 2,
      files: [
        {
          path: "/tmp/one file.txt",
          name: "one file.txt",
          size: 10,
          modificationDate: "1970-01-01T00:00:00.000Z",
        },
        {
          path: "/tmp/two.txt",
          name: "two.txt",
          size: 10,
          modificationDate: "1970-01-01T00:00:00.000Z",
        },
      ],
    });

    const recent = executeFinderScriptWithShell(recentFilesScript("/tmp", 7, 2), mdfind);
    expect(recent.result).toEqual({
      total: 2,
      files: [
        { path: "/tmp/one file.txt", name: "one file.txt" },
        { path: "/tmp/two.txt", name: "two.txt" },
      ],
    });

    const ls = `ls() { printf '%s\\n' 'one file.txt' 'two.txt' 'three.txt'; }`;
    const directory = executeFinderScriptWithShell(listDirectoryScript("/tmp", 2), ls, "10 0 Plain Text");
    expect(directory.result).toEqual({
      total: 2,
      returned: 2,
      items: [
        {
          name: "one file.txt",
          kind: "Plain Text",
          size: 10,
          modificationDate: "1970-01-01T00:00:00.000Z",
        },
        {
          name: "two.txt",
          kind: "Plain Text",
          size: 10,
          modificationDate: "1970-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  test("searchFilesScript preserves shell-sensitive folder and query arguments verbatim", () => {
    const root = mkdtempSync(join(tmpdir(), "airmcp-finder-escape-"));
    const folder = join(root, 'space " $dollar `tick` \\ slash');
    const query = 'report "quoted" $HOME $(printf injected) `printf injected` \\end';
    mkdirSync(folder);

    try {
      const { commands } = executeFinderScript(searchFilesScript(folder, query, 10));
      const shell = runShell(commands[0], `mdfind() { printf '%s\\n' "$@"; }`);
      expect(shell.status).toBe(0);
      expect(shell.stdout.trim().split("\n")).toEqual(["-onlyin", folder, query]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});

describe("finder esc() injection prevention", () => {
  test("escapes single quotes in path", () => {
    const script = getFileInfoScript("/Users/test/it's a file.txt");
    expect(script).toContain("it\\'s a file.txt");
  });

  test("escapes double quotes in query (JXA+shell context)", () => {
    const script = searchFilesScript("~", 'say "hello"', 10);
    expect(script).toContain('say \\\\\\"hello\\\\\\"');
  });
});
