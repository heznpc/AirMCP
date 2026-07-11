#!/usr/bin/env node
// RFC 0005 Step 2 — local Keycloak devcontainer launcher.
//
// Spins up a pinned Keycloak image, imports the `airmcp` realm from
// docker/keycloak-realm.json (single client `airmcp-dev`, single user
// `dev/dev`, scopes `mcp:read mcp:write mcp:destructive mcp:admin`),
// then prints the exact env vars and curl snippet a developer needs
// to run AirMCP against it locally.
//
// Goals
//   • Zero interaction — `npm run dev:oauth` and wait.
//   • Deterministic realm — the JSON import is version-controlled.
//   • Clean exit — Ctrl-C stops the container.
//
// This is intentionally a shell wrapper around docker / docker compose;
// reimplementing it natively would couple AirMCP's dev UX to a specific
// Node OAuth framework. The compose file + realm JSON stay readable by
// hand, so developers who need to customize are one file edit away.

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEV_OAUTH_PROXY_HOST,
  DEV_OAUTH_PROXY_PORT,
  DEV_OAUTH_UPSTREAM_ORIGIN,
  startLoopbackHttpsProxy,
} from "./lib/dev-oauth-https-proxy.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMPOSE_FILE = join(ROOT, "docker", "docker-compose.dev-oauth.yml");

if (!existsSync(COMPOSE_FILE)) {
  console.error(`[dev:oauth] compose file not found at ${COMPOSE_FILE}`);
  process.exit(1);
}

const tlsDir = mkdtempSync(join(tmpdir(), "airmcp-dev-oauth-"));
const certificateFile = join(tlsDir, "localhost.pem");
const privateKeyFile = join(tlsDir, "localhost-key.pem");
const cleanupTls = () => rmSync(tlsDir, { force: true, recursive: true });
process.once("exit", cleanupTls);

// AirMCP deliberately rejects plaintext OAuth issuers, including localhost.
// Generate an ephemeral development CA certificate instead of adding a
// production-code bypass. The private key exists only while this process is
// alive and is deleted when the container exits.
const openssl = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "7",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    "-addext",
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext",
    "keyUsage=critical,keyCertSign,digitalSignature,keyEncipherment",
    "-out",
    certificateFile,
    "-keyout",
    privateKeyFile,
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

if (openssl.error || openssl.status !== 0) {
  cleanupTls();
  const detail = openssl.error?.message ?? (openssl.stderr?.trim() || `exit ${openssl.status}`);
  console.error(`[dev:oauth] failed to generate the ephemeral localhost certificate: ${detail}`);
  console.error("[dev:oauth] install OpenSSL with support for req -addext and try again.");
  process.exit(1);
}

// The Keycloak image runs as an unprivileged container user. These files are
// short-lived, contain no production secret, and the whole directory is
// removed on exit; read permission is required across the bind mount.
chmodSync(tlsDir, 0o755);
chmodSync(certificateFile, 0o644);
chmodSync(privateKeyFile, 0o644);

const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
const quotedCertificateFile = shellQuote(certificateFile);

const banner = [
  "",
  "[dev:oauth] starting Keycloak dev realm (airmcp) on https://localhost:8443",
  "",
  "  Once the admin console comes up (~15s), in a new shell run:",
  "",
  `    export NODE_EXTRA_CA_CERTS=${quotedCertificateFile}`,
  "    export AIRMCP_OAUTH_ISSUER=https://localhost:8443/realms/airmcp",
  `    export AIRMCP_OAUTH_AUDIENCE=https://${DEV_OAUTH_PROXY_HOST}:${DEV_OAUTH_PROXY_PORT}/mcp`,
  "    export AIRMCP_ALLOW_NETWORK=with-oauth",
  "    npm run dev -- --http --port 3000",
  "",
  "  Fetch a token (password grant, dev-only):",
  "",
  `    curl -s --cacert ${quotedCertificateFile} -X POST https://localhost:8443/realms/airmcp/protocol/openid-connect/token \\`,
  '      -H "Content-Type: application/x-www-form-urlencoded" \\',
  '      -d "grant_type=password&client_id=airmcp-dev&username=dev&password=dev&scope=mcp:read mcp:write"',
  "",
  "  Call AirMCP with the returned access_token:",
  "",
  `    curl -s --cacert ${quotedCertificateFile} https://${DEV_OAUTH_PROXY_HOST}:${DEV_OAUTH_PROXY_PORT}/.well-known/oauth-protected-resource | jq .`,
  `    curl -s --cacert ${quotedCertificateFile} https://${DEV_OAUTH_PROXY_HOST}:${DEV_OAUTH_PROXY_PORT}/.well-known/mcp.json | jq .authorization`,
  "",
  "  This validates Node/curl only; the ephemeral CA is not installed into a browser trust store",
  "  and this launcher does not host an Authorization Code callback application.",
  "",
  "  Ctrl-C to stop Keycloak and the loopback HTTPS proxy.",
  "",
].join("\n");

// Prefer `docker compose` (v2) over legacy `docker-compose`. The Docker
// Desktop default on macOS/Linux 2023+ is v2; fall back for CI / older
// installs that still have the standalone binary.
async function hasDockerComposeV2() {
  return new Promise((resolve) => {
    const p = spawn("docker", ["compose", "version"], { stdio: "ignore" });
    let settled = false;
    let timeout;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(available);
    };
    timeout = setTimeout(() => {
      p.kill("SIGTERM");
      setTimeout(() => p.kill("SIGKILL"), 1_000).unref();
      finish(false);
    }, 5_000);
    p.on("exit", (code) => finish(code === 0));
    p.on("error", () => finish(false));
  });
}

const v2 = await hasDockerComposeV2();
const cmd = v2 ? "docker" : "docker-compose";
const args = v2 ? ["compose", "-f", COMPOSE_FILE, "up"] : ["-f", COMPOSE_FILE, "up"];
const downArgs = v2
  ? ["compose", "-f", COMPOSE_FILE, "down", "--remove-orphans"]
  : ["-f", COMPOSE_FILE, "down", "--remove-orphans"];
const composeEnv = { ...process.env, AIRMCP_DEV_OAUTH_TLS_DIR: tlsDir };

let child;
let proxy;
let shutdownPromise;

function childIsRunning(process) {
  return Boolean(process?.pid && process.exitCode === null && process.signalCode === null);
}

function waitForChildExit(process) {
  if (!childIsRunning(process)) return Promise.resolve();
  return new Promise((resolve) => {
    let killTimer;
    let forceTimer;
    const termTimer = setTimeout(() => {
      process.kill("SIGTERM");
      killTimer = setTimeout(() => {
        process.kill("SIGKILL");
        forceTimer = setTimeout(finish, 2_000);
      }, 5_000);
    }, 5_000);
    const finish = () => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      resolve();
    };
    process.once("error", finish);
    process.once("exit", finish);
  });
}

async function removeComposeResources() {
  await new Promise((resolve) => {
    const down = spawn(cmd, downArgs, { env: composeEnv, stdio: "inherit" });
    let settled = false;
    let timeout;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    timeout = setTimeout(() => {
      console.error("[dev:oauth] compose cleanup timed out; terminating the cleanup process");
      down.kill("SIGTERM");
      setTimeout(() => down.kill("SIGKILL"), 2_000).unref();
      finish();
    }, 15_000);
    down.once("error", (error) => {
      console.error(`[dev:oauth] could not run compose cleanup: ${error.message}`);
      finish();
    });
    down.once("exit", (code) => {
      if (code !== 0) console.error(`[dev:oauth] compose cleanup exited with code ${code ?? "unknown"}`);
      finish();
    });
  });
}

function shutdown({ detail, exitCode = 0 } = {}) {
  if (detail) console.error(`[dev:oauth] ${detail}`);
  if (shutdownPromise) {
    if (exitCode !== 0) process.exitCode = exitCode;
    return shutdownPromise;
  }
  process.exitCode = exitCode;
  shutdownPromise = (async () => {
    try {
      await proxy?.close();
    } catch (error) {
      console.error(`[dev:oauth] HTTPS proxy cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }

    if (childIsRunning(child)) {
      const exited = waitForChildExit(child);
      child.kill("SIGINT");
      await exited;
    }
    await removeComposeResources();
    cleanupTls();
  })();
  return shutdownPromise;
}

try {
  proxy = await startLoopbackHttpsProxy({
    certificate: readFileSync(certificateFile),
    privateKey: readFileSync(privateKeyFile),
    onFatalError: (error) => {
      void shutdown({ detail: `loopback HTTPS proxy failed: ${error.message}`, exitCode: 1 });
    },
  });
} catch (error) {
  cleanupTls();
  console.error(`[dev:oauth] could not start the loopback HTTPS proxy: ${error.message}`);
  process.exit(1);
}

console.error(`[dev:oauth] loopback HTTPS resource proxy: ${proxy.origin} -> ${DEV_OAUTH_UPSTREAM_ORIGIN}`);
console.error(banner);

child = spawn(cmd, args, {
  env: composeEnv,
  stdio: "inherit",
});
const stop = () => void shutdown();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.on("error", (error) => {
  void shutdown({ detail: `failed to start ${cmd}: ${error.message}`, exitCode: 1 });
});
child.on("exit", (code) => {
  void shutdown({ exitCode: code ?? 1 });
});
