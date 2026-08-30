import { afterEach, describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_RUNTIME_REQUEST_NONCE_HEADER,
  APP_RUNTIME_RESPONSE_PROOF_HEADER,
  liveProcessSignatureArguments,
  readPrivateOwnerSecret,
  runtimeGenerationBearer,
  runtimeIdentityProof,
  runtimeResponseProof,
  validateAppOwnedListenerIdentity,
  verifyRuntimeIdentityChallenge,
} from "../dist/shared/app-runtime-identity.js";

const OWNER_SECRET = "a".repeat(43);
const VERSION = "2.16.6";
const tempDirs = [];
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function makeOwnerSecret() {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-connect-identity-"));
  tempDirs.push(directory);
  const ownerSecretPath = join(directory, "runtime-owner-secret");
  writeFileSync(ownerSecretPath, `${OWNER_SECRET}\n`, { mode: 0o600 });
  return { directory, ownerSecretPath };
}

function verifiedListener(pid = 123) {
  return {
    pid,
    uid: process.getuid?.() ?? 501,
    executablePath: "/Applications/AirMCP.app/Contents/Resources/airmcp/runtime/bin/node",
    command:
      "/Applications/AirMCP.app/Contents/Resources/airmcp/runtime/bin/node " +
      "/Applications/AirMCP.app/Contents/Resources/airmcp/server/dist/index.js --http --port 3847",
    parentPid: 42,
    parentUid: process.getuid?.() ?? 501,
    parentExecutablePath: "/Applications/AirMCP.app/Contents/MacOS/AirMCP",
  };
}

async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

describe("shared app runtime identity", () => {
  test("reads only a regular owner-only credential", () => {
    const { directory, ownerSecretPath } = makeOwnerSecret();
    expect(readPrivateOwnerSecret(ownerSecretPath)).toBe(OWNER_SECRET);

    const link = join(directory, "owner-link");
    symlinkSync(ownerSecretPath, link);
    expect(() => readPrivateOwnerSecret(link)).toThrow(/symbolic link/);
    chmodSync(ownerSecretPath, 0o640);
    expect(() => readPrivateOwnerSecret(ownerSecretPath)).toThrow(/0600/);
  });

  test("verifies the live app and Node PIDs against pinned signing requirements", () => {
    expect(liveProcessSignatureArguments(123, "app")).toEqual([
      "--verify",
      "--strict",
      "--requirement",
      expect.stringContaining('identifier "app.airmcp"'),
      "+123",
    ]);
    expect(liveProcessSignatureArguments(456, "node")).toEqual([
      "--verify",
      "--strict",
      "--requirement",
      expect.stringContaining('identifier "node"'),
      "+456",
    ]);
    expect(() => liveProcessSignatureArguments(1, "app")).toThrow(/PID/);
  });

  test("rejects a FIFO without blocking on a writer", () => {
    const directory = mkdtempSync(join(tmpdir(), "airmcp-connect-identity-"));
    tempDirs.push(directory);
    const fifo = join(directory, "owner-fifo");
    execFileSync("/usr/bin/mkfifo", [fifo]);
    expect(() => readPrivateOwnerSecret(fifo)).toThrow(/not a regular file/);
  });

  test("rejects an oversized credential before reading its contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "airmcp-connect-identity-"));
    tempDirs.push(directory);
    const oversized = join(directory, "oversized-owner-secret");
    writeFileSync(oversized, "a".repeat(1_000_000), { mode: 0o600 });
    expect(() => readPrivateOwnerSecret(oversized)).toThrow(/invalid size/);
  });

  test("uses a tokenless fresh challenge and derives the generation bearer", async () => {
    const { ownerSecretPath } = makeOwnerSecret();
    const requests = [];
    const url = await listen((request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (requestUrl.pathname === "/mcp") {
        const requestNonce = request.headers[APP_RUNTIME_REQUEST_NONCE_HEADER];
        response.writeHead(200, {
          "content-type": "application/json",
          [APP_RUNTIME_RESPONSE_PROOF_HEADER]: runtimeResponseProof(
            OWNER_SECRET,
            requestNonce,
            123,
            VERSION,
            request.method,
            requestUrl.pathname,
          ),
        });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      const nonce = requestUrl.searchParams.get("nonce");
      requests.push({ path: requestUrl.pathname, nonce, authorization: request.headers.authorization });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          appOwned: true,
          pid: 123,
          version: VERSION,
          proof: runtimeIdentityProof(OWNER_SECRET, nonce, 123, VERSION),
          responseProof: "hmac-sha256-v1",
        }),
      );
    });

    const receipt = await verifyRuntimeIdentityChallenge(
      { url, ownerSecretPath, expectedVersion: VERSION },
      { verifyListener: () => verifiedListener() },
    );
    expect(receipt.authorizationToken).toBe(runtimeGenerationBearer(OWNER_SECRET, 123, VERSION));
    const authenticated = await receipt.authenticatedFetch(url, { method: "POST" });
    expect(await authenticated.json()).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/app/identity-challenge");
    expect(requests[0].nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requests[0].authorization).toBeUndefined();
  });

  test("rejects an invalid proof before returning any bearer", async () => {
    const { ownerSecretPath } = makeOwnerSecret();
    const url = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          appOwned: true,
          pid: 123,
          version: VERSION,
          proof: "0".repeat(64),
          responseProof: "hmac-sha256-v1",
        }),
      );
    });

    await expect(
      verifyRuntimeIdentityChallenge({ url, ownerSecretPath }, { verifyListener: () => verifiedListener() }),
    ).rejects.toThrow(/proof is invalid/);
  });

  test("binds the challenge PID to a verified app child before deriving a bearer", async () => {
    const { ownerSecretPath } = makeOwnerSecret();
    const url = await listen((request, response) => {
      const nonce = new URL(request.url, "http://127.0.0.1").searchParams.get("nonce");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          appOwned: true,
          pid: 123,
          version: VERSION,
          proof: runtimeIdentityProof(OWNER_SECRET, nonce, 123, VERSION),
          responseProof: "hmac-sha256-v1",
        }),
      );
    });

    await expect(
      verifyRuntimeIdentityChallenge({ url, ownerSecretPath }, { verifyListener: () => verifiedListener(456) }),
    ).rejects.toThrow(/expected app-owned runtime/);
  });

  test("rejects a listener change after the HMAC challenge", async () => {
    const { ownerSecretPath } = makeOwnerSecret();
    const url = await listen((request, response) => {
      const nonce = new URL(request.url, "http://127.0.0.1").searchParams.get("nonce");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          appOwned: true,
          pid: 123,
          version: VERSION,
          proof: runtimeIdentityProof(OWNER_SECRET, nonce, 123, VERSION),
          responseProof: "hmac-sha256-v1",
        }),
      );
    });
    let inspections = 0;

    await expect(
      verifyRuntimeIdentityChallenge(
        { url, ownerSecretPath },
        { verifyListener: () => verifiedListener(inspections++ === 0 ? 123 : 456) },
      ),
    ).rejects.toThrow(/listener changed/);
  });

  test("rejects an MCP response that is not MACed by the challenged runtime", async () => {
    const { ownerSecretPath } = makeOwnerSecret();
    const url = await listen((request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (requestUrl.pathname === "/mcp") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ spoofed: true }));
        return;
      }
      const nonce = requestUrl.searchParams.get("nonce");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          appOwned: true,
          pid: 123,
          version: VERSION,
          proof: runtimeIdentityProof(OWNER_SECRET, nonce, 123, VERSION),
          responseProof: "hmac-sha256-v1",
        }),
      );
    });
    const receipt = await verifyRuntimeIdentityChallenge(
      { url, ownerSecretPath },
      { verifyListener: () => verifiedListener() },
    );

    await expect(receipt.authenticatedFetch(url, { method: "POST" })).rejects.toThrow(/response proof/);
  });

  test("rejects localhost and IPv6 aliases instead of relaying a canonical challenge", async () => {
    const { ownerSecretPath } = makeOwnerSecret();
    for (const url of ["http://localhost:3847/mcp", "http://[::1]:3847/mcp"]) {
      await expect(
        verifyRuntimeIdentityChallenge({ url, ownerSecretPath }, { verifyListener: () => verifiedListener() }),
      ).rejects.toThrow(/canonical http:\/\/127\.0\.0\.1/);
    }
  });

  test("rejects a same-user listener whose parent is not the installed AirMCP app", () => {
    const directory = mkdtempSync(join(tmpdir(), "airmcp-listener-paths-"));
    tempDirs.push(directory);
    const appExecutable = join(directory, "AirMCP");
    const nodePath = join(directory, "node");
    const serverEntry = join(directory, "index.js");
    for (const path of [appExecutable, nodePath, serverEntry]) writeFileSync(path, "fixture", { mode: 0o700 });

    expect(() =>
      validateAppOwnedListenerIdentity(
        {
          pid: 123,
          uid: process.getuid?.() ?? 501,
          executablePath: realpathSync(nodePath),
          command: `${realpathSync(nodePath)} ${realpathSync(serverEntry)} --http --port 3847`,
          parentPid: 42,
          parentUid: process.getuid?.() ?? 501,
          parentExecutablePath: process.execPath,
        },
        {
          appPath: directory,
          appExecutable,
          nodePath,
          serverEntry,
          mcpUrl: "http://127.0.0.1:3847/mcp",
        },
      ),
    ).toThrow(/not launched by the verified AirMCP app/);
  });
});
