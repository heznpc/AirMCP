import { afterEach, describe, expect, test } from "@jest/globals";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHATGPT_APP_ID_PATTERN, validateChatgptPlugin } from "../scripts/validate-chatgpt-plugin.mjs";
import { makeCodexCachebuster, stageChatgptPlugin } from "../scripts/stage-chatgpt-plugin.mjs";
import {
  appRuntimeOpenArgs,
  listenerInspectionArgs,
  makeProxyEnvironment,
  readHealth,
  readPrivateOwnerSecret,
  resolveRuntimePaths,
  runtimeGenerationBearer,
  runtimeIdentityProof,
  validateLoopbackMcpUrl,
  validateListenerIdentity,
  verifyRuntimeIdentityChallenge,
} from "../plugins/airmcp/scripts/airmcp-app-stdio.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLUGIN_ROOT = join(ROOT, "plugins", "airmcp");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const APP_ID = "plugin_asdk_app_0123456789abcdef0123456789abcdef";
const CACHEBUSTER = "local-20260830-120000";
const tempDirs = [];

function pluginText() {
  return readdirSync(PLUGIN_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /(?:^|\.)(?:json|md|mjs|js|sh|ya?ml)$/i.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("AirMCP ChatGPT plugin package", () => {
  test("source package is valid, version-synced, and app-owned", () => {
    const validation = validateChatgptPlugin(PLUGIN_ROOT, { expectedVersion: PACKAGE.version });
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    const manifest = validation.manifest;
    expect(manifest.apps).toBeUndefined();
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(manifest.skills).toBe("./skills/");

    const mcp = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.airmcp).toEqual({
      command: "/usr/bin/env",
      args: ["-i", "PATH=/usr/bin:/bin:/usr/sbin:/sbin", "/bin/sh", "./scripts/launch-airmcp-connector.sh"],
      cwd: ".",
    });
    const launcher = readFileSync(join(PLUGIN_ROOT, "scripts", "launch-airmcp-connector.sh"), "utf8");
    expect(launcher).toContain("codesign --verify --deep --strict --requirement");
    expect(launcher).toContain('anchor apple generic and identifier "app.airmcp"');
    expect(launcher).toContain('certificate leaf[subject.OU] = "XS7HJJN7GC"');
  });

  test("source package has no developer connection id, token, or personal path", () => {
    const text = pluginText();
    expect(text).not.toMatch(/plugin_asdk_app_[A-Za-z0-9]{16,}/);
    expect(text).not.toMatch(/\/Users\/[^\s"']+/);
    expect(text).not.toMatch(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/);
    expect(text).not.toMatch(/AIRMCP_HTTP_TOKEN\s*[:=]\s*["'][A-Za-z0-9_-]{32,}["']/);
  });

  test("staging injects only the registered ChatGPT connection into a copy", () => {
    const temp = mkdtempSync(join(tmpdir(), "airmcp-chatgpt-plugin-"));
    tempDirs.push(temp);
    const outputDir = join(temp, "stage");
    const sourceBefore = readFileSync(join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8");

    const staged = stageChatgptPlugin({
      appId: APP_ID,
      outputDir,
      sourcePlugin: PLUGIN_ROOT,
      expectedVersion: PACKAGE.version,
      cachebuster: CACHEBUSTER,
    });
    const stagedManifest = JSON.parse(readFileSync(join(staged.pluginPath, ".codex-plugin", "plugin.json"), "utf8"));
    const app = JSON.parse(readFileSync(join(staged.pluginPath, ".app.json"), "utf8"));
    const marketplace = JSON.parse(readFileSync(staged.marketplacePath, "utf8"));

    expect(stagedManifest.apps).toBe("./.app.json");
    expect(stagedManifest.version).toBe(`${PACKAGE.version}+codex.${CACHEBUSTER}`);
    expect(staged.pluginVersion).toBe(stagedManifest.version);
    expect(app).toEqual({ apps: { airmcp: { id: APP_ID } } });
    expect(marketplace.plugins[0].source.path).toBe("./plugins/airmcp");
    expect(readFileSync(join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8")).toBe(sourceBefore);
    expect(
      validateChatgptPlugin(staged.pluginPath, {
        expectedVersion: PACKAGE.version,
        allowCodexCachebuster: true,
        allowRegisteredApp: true,
      }).ok,
    ).toBe(true);
    expect(
      validateChatgptPlugin(staged.pluginPath, {
        expectedVersion: PACKAGE.version,
        allowCodexCachebuster: true,
      }).errors,
    ).toContain("source plugin manifest must omit apps; add the registered mapping only while staging");
  });

  test("staging cachebusters are UTC, stable in shape, and replace build metadata", () => {
    expect(makeCodexCachebuster(new Date("2026-08-30T12:00:00.000Z"))).toBe(CACHEBUSTER);
  });

  test("staging refuses the source tree as output", () => {
    expect(() =>
      stageChatgptPlugin({
        appId: APP_ID,
        outputDir: join(PLUGIN_ROOT, "generated-test"),
        sourcePlugin: PLUGIN_ROOT,
        expectedVersion: PACKAGE.version,
        cachebuster: CACHEBUSTER,
      }),
    ).toThrow(/unsafe staging output/);
  });

  test("staging validates inputs before replacing an existing output", () => {
    const temp = mkdtempSync(join(tmpdir(), "airmcp-chatgpt-plugin-"));
    tempDirs.push(temp);
    const outputDir = join(temp, "stage");
    mkdirSync(outputDir);
    const marker = join(outputDir, "keep-me");
    writeFileSync(marker, "existing output");

    expect(() =>
      stageChatgptPlugin({
        appId: APP_ID,
        outputDir,
        force: true,
        sourcePlugin: PLUGIN_ROOT,
        expectedVersion: PACKAGE.version,
        cachebuster: "invalid",
      }),
    ).toThrow(/cachebuster/);
    expect(readFileSync(marker, "utf8")).toBe("existing output");
  });

  test("force replaces only an output created by this stager", () => {
    const temp = mkdtempSync(join(tmpdir(), "airmcp-chatgpt-plugin-"));
    tempDirs.push(temp);
    const outputDir = join(temp, "stage");
    mkdirSync(outputDir);
    const unrelated = join(outputDir, "unrelated");
    writeFileSync(unrelated, "do not delete");

    expect(() =>
      stageChatgptPlugin({
        appId: APP_ID,
        outputDir,
        force: true,
        sourcePlugin: PLUGIN_ROOT,
        expectedVersion: PACKAGE.version,
        cachebuster: CACHEBUSTER,
      }),
    ).toThrow(/unowned staging output/);
    expect(readFileSync(unrelated, "utf8")).toBe("do not delete");

    rmSync(outputDir, { recursive: true });
    stageChatgptPlugin({
      appId: APP_ID,
      outputDir,
      sourcePlugin: PLUGIN_ROOT,
      expectedVersion: PACKAGE.version,
      cachebuster: CACHEBUSTER,
    });
    const replacement = stageChatgptPlugin({
      appId: APP_ID,
      outputDir,
      force: true,
      sourcePlugin: PLUGIN_ROOT,
      expectedVersion: PACKAGE.version,
      cachebuster: "local-20260830-120001",
    });
    expect(replacement.pluginVersion).toBe(`${PACKAGE.version}+codex.local-20260830-120001`);

    const unknown = join(outputDir, "keep-me");
    writeFileSync(unknown, "not generated by the stager");
    expect(() =>
      stageChatgptPlugin({
        appId: APP_ID,
        outputDir,
        force: true,
        sourcePlugin: PLUGIN_ROOT,
        expectedVersion: PACKAGE.version,
        cachebuster: "local-20260830-120002",
      }),
    ).toThrow(/unknown files/);
    expect(readFileSync(unknown, "utf8")).toBe("not generated by the stager");
  });

  test("staging rejects placeholder and malformed connection ids", () => {
    expect(CHATGPT_APP_ID_PATTERN.test(APP_ID)).toBe(true);
    expect(() => stageChatgptPlugin({ appId: "plugin_asdk_app_TODO", outputDir: join(tmpdir(), "unused") })).toThrow(
      /real plugin_asdk_app/,
    );
  });
});

describe("AirMCP app-owned connector boundaries", () => {
  test("owner-secret listener proof matches the native runtime contract", () => {
    const temp = mkdtempSync(join(tmpdir(), "airmcp-plugin-owner-secret-"));
    tempDirs.push(temp);
    const ownerSecretPath = join(temp, "runtime-owner-secret");
    const secret = "a".repeat(43);
    writeFileSync(ownerSecretPath, `${secret}\n`, { mode: 0o600 });

    expect(readPrivateOwnerSecret(ownerSecretPath)).toBe(secret);
    expect(runtimeIdentityProof(secret, "b".repeat(43), 123, "2.16.5")).toBe(
      "0d01fef81ad4d828dcf263f268d2906f4c965bcb3e93cef4ae7b216ebcac9830",
    );
    expect(runtimeGenerationBearer(secret, 123, "2.16.5")).toBe(
      "airmcp_app_897599a80e1c449a8beeba036882deeeb1c801e7498a30f0b0d4cb7a4f101197",
    );
    const symlinkPath = join(temp, "runtime-owner-secret-link");
    symlinkSync(ownerSecretPath, symlinkPath);
    expect(() => readPrivateOwnerSecret(symlinkPath)).toThrow(/symbolic link/);
    chmodSync(ownerSecretPath, 0o644);
    expect(() => readPrivateOwnerSecret(ownerSecretPath)).toThrow(/0600/);
  });

  test("listener challenge is verified before the bearer token can be used", async () => {
    const temp = mkdtempSync(join(tmpdir(), "airmcp-plugin-owner-secret-"));
    tempDirs.push(temp);
    const ownerSecretPath = join(temp, "runtime-owner-secret");
    const secret = "a".repeat(43);
    writeFileSync(ownerSecretPath, `${secret}\n`, { mode: 0o600 });
    const expectedPid = 123;
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const nonce = url.searchParams.get("nonce");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          version: PACKAGE.version,
          appOwned: true,
          pid: expectedPid,
          proof: runtimeIdentityProof(secret, nonce, expectedPid, PACKAGE.version),
        }),
      );
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    try {
      const receipt = await verifyRuntimeIdentityChallenge(
        {
          mcpUrl: `http://127.0.0.1:${address.port}/mcp`,
          ownerSecretPath,
        },
        expectedPid,
      );
      expect(receipt.challenge.version).toBe(PACKAGE.version);
      expect(receipt.authorizationToken).toMatch(/^airmcp_app_[0-9a-f]{64}$/);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });

  test("tunnel control-plane credentials are not forwarded into AirMCP", () => {
    const childEnv = makeProxyEnvironment(
      {
        HOME: "/tmp/attacker-home",
        PATH: "/usr/bin",
        CONTROL_PLANE_API_KEY: "sensitive-tunnel-key",
        AIRMCP_APP_PATH: "/tmp/fake.app",
        AIRMCP_APP_TEAM_ID: "ATTACKER",
        AIRMCP_CONNECT_URL: "http://127.0.0.1:9999/mcp",
        AIRMCP_SKIP_APP_SIGNATURE_CHECK: "1",
        NODE_OPTIONS: "--require=/tmp/steal-token.cjs",
        NODE_PATH: "/tmp/attacker-modules",
        DYLD_INSERT_LIBRARIES: "/tmp/steal-token.dylib",
        LD_PRELOAD: "/tmp/steal-token.so",
        HTTPS_PROXY: "http://attacker.invalid:8080",
      },
      "local-app-token",
    );
    expect(childEnv.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(childEnv.HOME).not.toBe("/tmp/attacker-home");
    expect(childEnv.AIRMCP_HTTP_TOKEN).toBe("local-app-token");
    expect(childEnv.AIRMCP_CONNECT_NO_LAUNCH).toBe("1");
    expect(childEnv.CONTROL_PLANE_API_KEY).toBeUndefined();
    expect(childEnv.AIRMCP_APP_PATH).toBeUndefined();
    expect(childEnv.AIRMCP_APP_TEAM_ID).toBeUndefined();
    expect(childEnv.AIRMCP_CONNECT_URL).toBeUndefined();
    expect(childEnv.AIRMCP_SKIP_APP_SIGNATURE_CHECK).toBeUndefined();
    expect(childEnv.NODE_OPTIONS).toBeUndefined();
    expect(childEnv.NODE_PATH).toBeUndefined();
    expect(childEnv.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(childEnv.LD_PRELOAD).toBeUndefined();
    expect(childEnv.HTTPS_PROXY).toBeUndefined();
  });

  test("security anchors cannot be redirected through the tunnel environment", () => {
    const paths = resolveRuntimePaths({
      AIRMCP_APP_PATH: "/tmp/fake.app",
      AIRMCP_APP_BUNDLE_ID: "example.fake",
      AIRMCP_APP_TEAM_ID: "ATTACKER",
      AIRMCP_CONNECT_URL: "http://127.0.0.1:9999/mcp",
    });
    expect(paths.appPath).toBe("/Applications/AirMCP.app");
    expect(paths.bundleId).toBe("app.airmcp");
    expect(paths.teamId).toBe("XS7HJJN7GC");
    expect(paths.mcpUrl).toBe("http://127.0.0.1:3847/mcp");
    expect(paths.runtimeTokenPath).toMatch(/\/Library\/Application Support\/AirMCP\/http-token$/);
  });

  test("listener identity must bind the current user, bundled runtime, and app parent", () => {
    const paths = {
      mcpUrl: "http://127.0.0.1:3847/mcp",
      nodePath: "/Applications/AirMCP.app/runtime/node",
      serverEntry: "/Applications/AirMCP.app/runtime/server.js",
      appExecutable: "/Applications/AirMCP.app/Contents/MacOS/AirMCP",
    };
    const identity = {
      pid: 101,
      uid: 501,
      executablePath: paths.nodePath,
      parentPid: 100,
      parentUid: 501,
      parentExecutablePath: paths.appExecutable,
      command: `${paths.nodePath} ${paths.serverEntry} --http --port 3847`,
    };
    expect(validateListenerIdentity(identity, paths, 501)).toBe(identity);
    expect(() => validateListenerIdentity({ ...identity, uid: 502 }, paths, 501)).toThrow(/current user/);
    expect(() =>
      validateListenerIdentity({ ...identity, parentExecutablePath: "/tmp/Fake.app/Fake" }, paths, 501),
    ).toThrow(/verified AirMCP app/);
  });

  test("connector accepts only loopback streamable HTTP endpoints", () => {
    expect(validateLoopbackMcpUrl("http://127.0.0.1:3847/mcp").port).toBe("3847");
    expect(listenerInspectionArgs("http://127.0.0.1:3847/mcp")).toContain("-iTCP:3847");
    expect(listenerInspectionArgs("http://127.0.0.1:3847/mcp").join(" ")).not.toContain("@127.0.0.1");
    expect(() => validateLoopbackMcpUrl("https://example.com/mcp")).toThrow(/loopback/);
    expect(() => validateLoopbackMcpUrl("http://127.0.0.1:3847/health")).toThrow(/loopback/);
  });

  test("runtime recovery targets the exact signed app with one canonical deep link", () => {
    const args = appRuntimeOpenArgs(resolveRuntimePaths());
    expect(args).toEqual(["-g", "-a", "/Applications/AirMCP.app", "airmcp://runtime/start"]);
    expect(args).not.toEqual(expect.arrayContaining(["-u", "-b", "-n", "--args"]));
  });

  test("health response must prove the runtime is app-owned", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", version: PACKAGE.version, appOwned: false }));
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    try {
      await expect(readHealth(`http://127.0.0.1:${address.port}/mcp`)).rejects.toThrow(/app-owned/);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });
});
