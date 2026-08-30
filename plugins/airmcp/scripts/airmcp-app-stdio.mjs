#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_APP_PATH = "/Applications/AirMCP.app";
const DEFAULT_BUNDLE_ID = "app.airmcp";
const DEFAULT_TEAM_ID = "XS7HJJN7GC";
const DEFAULT_APP_REQUIREMENT =
  'anchor apple generic and identifier "app.airmcp" and certificate leaf[subject.OU] = "XS7HJJN7GC"';
const DEFAULT_MCP_URL = "http://127.0.0.1:3847/mcp";
const RUNTIME_START_URL = "airmcp://runtime/start";
const MIN_APP_VERSION = "2.16.6";
const STARTUP_TIMEOUT_MS = 15_000;
const SAFE_CHILD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SAFE_LOCALE_KEYS = ["LANG", "LC_ALL", "LC_CTYPE"];

function fail(message) {
  throw new Error(`[AirMCP plugin] ${message}`);
}

export function resolveRuntimePaths() {
  const appPath = resolve(DEFAULT_APP_PATH);
  const resources = join(appPath, "Contents", "Resources", "airmcp");
  return {
    appPath,
    appExecutable: join(appPath, "Contents", "MacOS", "AirMCP"),
    bundleId: DEFAULT_BUNDLE_ID,
    teamId: DEFAULT_TEAM_ID,
    nodePath: join(resources, "runtime", "bin", "node"),
    serverEntry: join(resources, "server", "dist", "index.js"),
    runtimeTokenPath: join(userInfo().homedir, "Library", "Application Support", "AirMCP", "http-token"),
    ownerSecretPath: join(userInfo().homedir, "Library", "Application Support", "AirMCP", "runtime-owner-secret"),
    mcpUrl: DEFAULT_MCP_URL,
  };
}

function requireRegularFile(path, label) {
  if (!existsSync(path)) fail(`${label} is missing at ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fail(`${label} must not be a symbolic link: ${path}`);
  if (!stat.isFile()) fail(`${label} is not a regular file: ${path}`);
  return stat;
}

function requireOwnerOnlyFile(path, label, uid = process.getuid?.()) {
  const stat = requireRegularFile(path, label);
  if (typeof uid === "number" && stat.uid !== uid) {
    fail(`${label} is not owned by the current user: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    fail(`${label} permissions must be owner-only (0600): ${path}`);
  }
  return stat;
}

function codesignDetails(appPath) {
  const result = spawnSync("/usr/bin/codesign", ["-dvvv", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`could not inspect the AirMCP.app signature: ${(result.stderr || result.stdout).trim()}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function verifyInstalledApp(paths, options = {}) {
  requireRegularFile(paths.appExecutable, "AirMCP app executable");
  requireRegularFile(paths.nodePath, "bundled Node runtime");
  requireRegularFile(paths.serverEntry, "bundled AirMCP server");

  if (options.skipSignatureCheck) return;

  const verification = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--requirement", DEFAULT_APP_REQUIREMENT, paths.appPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (verification.status !== 0) {
    fail(`AirMCP.app failed strict signature verification: ${(verification.stderr || verification.stdout).trim()}`);
  }

  const details = codesignDetails(paths.appPath);
  const detailLines = details.split(/\r?\n/);
  if (!detailLines.includes(`Identifier=${paths.bundleId}`)) {
    fail(`AirMCP.app signature identifier is not ${paths.bundleId}`);
  }
  if (!detailLines.includes(`TeamIdentifier=${paths.teamId}`)) {
    fail(`AirMCP.app signature team is not ${paths.teamId}`);
  }
}

function inspect(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout;
  if (options.allowNoMatch && result.status === 1 && !result.stdout.trim()) return "";
  fail(`${label} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
}

function parseLsofProcesses(output) {
  const records = [];
  let current;
  for (const line of output.split("\n")) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      current = { pid: Number(value), names: [] };
      records.push(current);
    } else if (field === "u" && current) {
      current.uid = Number(value);
    } else if (field === "n" && current) {
      current.names.push(value);
    }
  }
  return records.filter((record) => Number.isInteger(record.pid) && record.pid > 1);
}

export function listenerInspectionArgs(mcpUrl) {
  const url = validateLoopbackMcpUrl(mcpUrl);
  const port = url.port || "80";
  return ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpu"];
}

function listenerProcesses(mcpUrl) {
  const output = inspect("/usr/sbin/lsof", listenerInspectionArgs(mcpUrl), "local listener inspection", {
    allowNoMatch: true,
  });
  return parseLsofProcesses(output);
}

function processDetails(pid) {
  const output = inspect(
    "/usr/sbin/lsof",
    ["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fpun"],
    `process ${pid} executable inspection`,
  );
  const record = parseLsofProcesses(output).find((candidate) => candidate.pid === pid);
  if (!record || !Number.isInteger(record.uid) || !record.names[0]) {
    fail(`process ${pid} identity is incomplete`);
  }
  const parentText = inspect("/bin/ps", ["-p", String(pid), "-o", "ppid="], `process ${pid} parent inspection`);
  const command = inspect("/bin/ps", ["-p", String(pid), "-o", "command="], `process ${pid} command inspection`).trim();
  const parentPid = Number(parentText.trim());
  if (!Number.isInteger(parentPid) || parentPid < 1 || !command) {
    fail(`process ${pid} has no verifiable app parent or command`);
  }
  return {
    pid,
    uid: record.uid,
    executablePath: realpathSync(record.names[0]),
    parentPid,
    command,
  };
}

export function validateListenerIdentity(identity, paths, uid = process.getuid?.()) {
  const port = new URL(paths.mcpUrl).port || "80";
  const expectedCommand = `${paths.nodePath} ${paths.serverEntry} --http --port ${port}`;
  if (typeof uid !== "number" || identity.uid !== uid || identity.parentUid !== uid) {
    fail("the AirMCP listener is not owned by the current user");
  }
  if (!Number.isInteger(identity.parentPid) || identity.parentPid <= 1) {
    fail("the AirMCP listener has no verifiable app parent");
  }
  if (identity.executablePath !== paths.nodePath || identity.command !== expectedCommand) {
    fail("the AirMCP listener is not the verified bundled runtime");
  }
  if (identity.parentExecutablePath !== paths.appExecutable) {
    fail("the AirMCP listener was not launched by the verified AirMCP app");
  }
  return identity;
}

export function verifyAppOwnedListener(paths, uid = process.getuid?.()) {
  const listeners = listenerProcesses(paths.mcpUrl);
  if (listeners.length !== 1) {
    fail(`expected exactly one AirMCP listener, found ${listeners.length}`);
  }
  const runtime = processDetails(listeners[0].pid);
  const parent = processDetails(runtime.parentPid);
  const canonicalPaths = {
    ...paths,
    appExecutable: realpathSync(paths.appExecutable),
    nodePath: realpathSync(paths.nodePath),
    serverEntry: realpathSync(paths.serverEntry),
  };
  return validateListenerIdentity(
    {
      ...runtime,
      parentUid: parent.uid,
      parentExecutablePath: parent.executablePath,
    },
    canonicalPaths,
    uid,
  );
}

export function readPrivateOwnerSecret(ownerSecretPath, uid = process.getuid?.()) {
  requireOwnerOnlyFile(ownerSecretPath, "app runtime owner secret", uid);
  const secret = readFileSync(ownerSecretPath, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    fail(`app runtime owner secret is malformed: ${ownerSecretPath}`);
  }
  return secret;
}

export function runtimeIdentityProof(ownerSecret, nonce, pid, version) {
  return createHmac("sha256", ownerSecret)
    .update(`airmcp-app-listener-v1\n${nonce}\n${pid}\n${version}`, "utf8")
    .digest("hex");
}

export function runtimeGenerationBearer(ownerSecret, pid, version) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(ownerSecret ?? "") ||
    !Number.isSafeInteger(pid) ||
    pid < 2 ||
    typeof version !== "string" ||
    version.length === 0
  ) {
    fail("AirMCP.app generation authorization inputs are invalid");
  }
  const proof = createHmac("sha256", ownerSecret)
    .update(`airmcp-app-generation-bearer-v1\n${pid}\n${version}`, "utf8")
    .digest("hex");
  return `airmcp_app_${proof}`;
}

export async function verifyRuntimeIdentityChallenge(paths, expectedPid, timeoutMs = 1_000) {
  const ownerSecret = readPrivateOwnerSecret(paths.ownerSecretPath);
  const nonce = randomBytes(32).toString("base64url");
  const challengeUrl = new URL("/app/identity-challenge", validateLoopbackMcpUrl(paths.mcpUrl));
  challengeUrl.searchParams.set("nonce", nonce);
  const response = await fetch(challengeUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) fail(`AirMCP.app identity challenge returned HTTP ${response.status}`);
  const challenge = await response.json();
  if (
    challenge?.status !== "ok" ||
    challenge?.appOwned !== true ||
    challenge?.pid !== expectedPid ||
    typeof challenge?.version !== "string" ||
    !/^[0-9a-f]{64}$/.test(challenge?.proof ?? "")
  ) {
    fail("AirMCP.app identity challenge did not match the verified listener");
  }
  const expected = runtimeIdentityProof(ownerSecret, nonce, challenge.pid, challenge.version);
  const actualBytes = Buffer.from(challenge.proof, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    fail("AirMCP.app identity challenge proof is invalid");
  }
  return {
    challenge,
    authorizationToken: runtimeGenerationBearer(ownerSecret, challenge.pid, challenge.version),
  };
}

export function validateLoopbackMcpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    fail(`invalid MCP URL: ${error instanceof Error ? error.message : String(error)}`);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback || url.pathname !== "/mcp") {
    fail("the app connector only accepts a loopback http://.../mcp URL");
  }
  return url;
}

export async function readHealth(mcpUrl, timeoutMs = 1_000) {
  const healthUrl = new URL("/health", validateLoopbackMcpUrl(mcpUrl));
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) fail(`AirMCP.app health check returned HTTP ${response.status}`);
  const health = await response.json();
  if (health?.status !== "ok" || health?.appOwned !== true || typeof health?.version !== "string") {
    fail("AirMCP.app health response does not identify an app-owned runtime");
  }
  return health;
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    if (!match) fail(`invalid AirMCP.app version: ${value}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function delay(ms) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function appRuntimeOpenArgs(paths) {
  return ["-g", "-a", paths.appPath, RUNTIME_START_URL];
}

function requestAppRuntimeStart(paths) {
  // Metadata-only consent check: the connector never reads or forwards the
  // persistent token, and cannot make a deep link create the first one.
  requireOwnerOnlyFile(paths.runtimeTokenPath, "existing app runtime consent");
  const result = spawnSync("/usr/bin/open", appRuntimeOpenArgs(paths), {
    encoding: "utf8",
    env: { PATH: SAFE_CHILD_PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(
      `could not request the signed AirMCP.app runtime: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`,
    );
  }
}

export async function ensureAppRuntime(paths, options = {}) {
  let shouldLaunch = false;
  try {
    const health = await readHealth(paths.mcpUrl, options.healthTimeoutMs);
    verifyAppOwnedListener(paths);
    return health;
  } catch (initialError) {
    if (options.noLaunch) throw initialError;
    const listeners = listenerProcesses(paths.mcpUrl);
    if (listeners.length > 0) {
      // Fail immediately if the reserved port is held by anything other than
      // this user's verified app child. Never launch the app into a hostile
      // listener. The app's own readiness probe also fails closed on its
      // owner-secret identity challenge before sending a bearer.
      verifyAppOwnedListener(paths);
    } else {
      shouldLaunch = true;
    }
  }

  if (shouldLaunch) {
    // Deliver the canonical GetURL event to this exact verified bundle path.
    // The native handler honors it only when the user has already enabled
    // app-runtime auto-start; it never creates first-run consent.
    requestAppRuntimeStart(paths);
  }

  const deadline = Date.now() + (options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
  let nextStartRequestAt = Date.now() + 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const health = await readHealth(paths.mcpUrl, options.healthTimeoutMs);
      verifyAppOwnedListener(paths);
      return health;
    } catch (error) {
      lastError = error;
      if (listenerProcesses(paths.mcpUrl).length > 0) {
        verifyAppOwnedListener(paths);
      } else if (shouldLaunch && Date.now() >= nextStartRequestAt) {
        // A graceful child shutdown can briefly precede Process termination
        // delivery in the menu-bar app. Repeat the idempotent authorized route
        // while the reserved port remains empty so that race cannot strand the
        // connector until its next full restart.
        requestAppRuntimeStart(paths);
        nextStartRequestAt = Date.now() + 1_000;
      }
      await delay(250);
    }
  }
  fail(
    `AirMCP.app did not expose its app-owned runtime within ${options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS}ms` +
      (lastError instanceof Error ? `: ${lastError.message}` : ""),
  );
}

export async function preflight(options = {}) {
  const paths = resolveRuntimePaths();
  validateLoopbackMcpUrl(paths.mcpUrl);
  verifyInstalledApp(paths, {
    skipSignatureCheck: options.skipSignatureCheck === true,
  });
  const health = await ensureAppRuntime(paths, options);
  if (compareVersions(health.version, MIN_APP_VERSION) < 0) {
    fail(`AirMCP.app ${MIN_APP_VERSION} or newer is required; found ${health.version}`);
  }
  const listener = verifyAppOwnedListener(paths);
  const receipt = await verifyRuntimeIdentityChallenge(paths, listener.pid, options.healthTimeoutMs);
  if (receipt.challenge.version !== health.version) {
    fail("AirMCP.app health and identity challenge versions do not match");
  }
  return { paths, health, listener, challenge: receipt.challenge };
}

export function makeProxyEnvironment(env, token) {
  const account = userInfo();
  const proxyEnvironment = {
    HOME: account.homedir,
    USER: account.username,
    LOGNAME: account.username,
    PATH: SAFE_CHILD_PATH,
    AIRMCP_CONNECT_NO_LAUNCH: "1",
    AIRMCP_HTTP_TOKEN: token,
  };
  for (const key of SAFE_LOCALE_KEYS) {
    const value = env[key];
    if (typeof value === "string" && /^[A-Za-z0-9_.@-]{1,64}$/.test(value)) {
      proxyEnvironment[key] = value;
    }
  }
  return proxyEnvironment;
}

export async function runConnector(env = process.env) {
  const { paths, health } = await preflight();
  const listener = verifyAppOwnedListener(paths);
  const receipt = await verifyRuntimeIdentityChallenge(paths, listener.pid);
  console.error(`[AirMCP plugin] connected to signed app-owned runtime v${health.version}`);

  const child = spawn(paths.nodePath, [paths.serverEntry, "connect", "--url", paths.mcpUrl], {
    env: makeProxyEnvironment(env, receipt.authorizationToken),
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const exit = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  if (exit.signal) return 128 + (exit.signal === "SIGINT" ? 2 : 15);
  return exit.code ?? 1;
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  runConnector()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
