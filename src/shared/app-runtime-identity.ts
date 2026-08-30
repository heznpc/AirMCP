import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOME } from "./constants.js";

export const APP_IDENTITY_CHALLENGE_PATH = "/app/identity-challenge";
export const APP_RUNTIME_OWNER_SECRET_PATH =
  process.env.AIRMCP_APP_RUNTIME_OWNER_PATH ||
  join(HOME, "Library", "Application Support", "AirMCP", "runtime-owner-secret");

const INSTALLED_APP_PATH = "/Applications/AirMCP.app";
const INSTALLED_APP_REQUIREMENT =
  'anchor apple generic and identifier "app.airmcp" and certificate leaf[subject.OU] = "XS7HJJN7GC"';
const INSTALLED_NODE_REQUIREMENT =
  'anchor apple generic and identifier "node" and certificate leaf[subject.OU] = "XS7HJJN7GC"';

export const APP_RUNTIME_REQUEST_NONCE_HEADER = "x-airmcp-runtime-nonce";
export const APP_RUNTIME_RESPONSE_PROOF_HEADER = "x-airmcp-runtime-proof";
export const APP_RUNTIME_RESPONSE_PROOF_SCHEME = "hmac-sha256-v1";

const OWNER_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{32,64}$/;
const PROOF_RE = /^[0-9a-f]{64}$/;

export interface AppRuntimePaths {
  appPath: string;
  appExecutable: string;
  nodePath: string;
  serverEntry: string;
  mcpUrl: string;
}

export interface AppOwnedListenerIdentity {
  pid: number;
  uid: number;
  executablePath: string;
  command: string;
  parentPid: number;
  parentUid: number;
  parentExecutablePath: string;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function installedAppRuntimePaths(mcpUrl: string): AppRuntimePaths {
  const appPath = resolve(INSTALLED_APP_PATH);
  const resources = join(appPath, "Contents", "Resources", "airmcp");
  return {
    appPath,
    appExecutable: join(appPath, "Contents", "MacOS", "AirMCP"),
    nodePath: join(resources, "runtime", "bin", "node"),
    serverEntry: join(resources, "server", "dist", "index.js"),
    mcpUrl,
  };
}

function requireRegularFile(path: string, label: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new Error(`${label} is missing: ${path}`, { cause: error });
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
}

function inspect(command: string, args: string[], label: string, allowNoMatch = false): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout;
  if (allowNoMatch && result.status === 1 && !result.stdout.trim()) return "";
  throw new Error(`${label} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
}

interface LsofRecord {
  pid: number;
  uid?: number;
  names: string[];
}

function parseLsofProcesses(output: string): LsofRecord[] {
  const records: LsofRecord[] = [];
  let current: LsofRecord | undefined;
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
  return records.filter((record) => Number.isSafeInteger(record.pid) && record.pid > 1);
}

function listenerProcesses(mcpUrl: string): LsofRecord[] {
  const url = new URL(mcpUrl);
  const port = url.port || "80";
  const output = inspect(
    "/usr/sbin/lsof",
    ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpu"],
    "local listener inspection",
    true,
  );
  return parseLsofProcesses(output);
}

function processDetails(pid: number): {
  pid: number;
  uid: number;
  executablePath: string;
  command: string;
  parentPid: number;
} {
  const output = inspect(
    "/usr/sbin/lsof",
    ["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fpun"],
    `process ${pid} executable inspection`,
  );
  const record = parseLsofProcesses(output).find((candidate) => candidate.pid === pid);
  const executablePath = record?.names[0];
  if (!record || !Number.isSafeInteger(record.uid) || record.uid === undefined || !executablePath) {
    throw new Error(`process ${pid} identity is incomplete`);
  }
  const parentText = inspect("/bin/ps", ["-p", String(pid), "-o", "ppid="], `process ${pid} parent inspection`);
  const command = inspect("/bin/ps", ["-p", String(pid), "-o", "command="], `process ${pid} command inspection`).trim();
  const parentPid = Number(parentText.trim());
  if (!Number.isSafeInteger(parentPid) || parentPid < 1 || !command) {
    throw new Error(`process ${pid} has no verifiable app parent or command`);
  }
  return { pid, uid: record.uid, executablePath: realpathSync(executablePath), command, parentPid };
}

function verifyInstalledApp(paths: AppRuntimePaths): void {
  requireRegularFile(paths.appExecutable, "AirMCP app executable");
  requireRegularFile(paths.nodePath, "bundled Node runtime");
  requireRegularFile(paths.serverEntry, "bundled AirMCP server");
  const verification = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--requirement", INSTALLED_APP_REQUIREMENT, paths.appPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (verification.status !== 0) {
    throw new Error(
      `installed AirMCP.app failed signature verification: ${(verification.stderr || verification.stdout).trim()}`,
    );
  }
}

export function liveProcessSignatureArguments(pid: number, role: "app" | "node"): string[] {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error("live code signature PID is invalid");
  const requirement = role === "app" ? INSTALLED_APP_REQUIREMENT : INSTALLED_NODE_REQUIREMENT;
  return ["--verify", "--strict", "--requirement", requirement, `+${pid}`];
}

function verifyLiveProcessSignature(pid: number, role: "app" | "node", label: string): void {
  const verification = spawnSync("/usr/bin/codesign", liveProcessSignatureArguments(pid, role), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (verification.status !== 0) {
    throw new Error(
      `${label} failed live signature verification: ${(verification.stderr || verification.stdout).trim()}`,
    );
  }
}

export function validateAppOwnedListenerIdentity(
  identity: AppOwnedListenerIdentity,
  paths: AppRuntimePaths,
  uid = process.getuid?.(),
): AppOwnedListenerIdentity {
  const port = new URL(paths.mcpUrl).port || "80";
  const canonicalPaths = {
    appExecutable: realpathSync(paths.appExecutable),
    nodePath: realpathSync(paths.nodePath),
    serverEntry: realpathSync(paths.serverEntry),
  };
  const expectedCommand = `${canonicalPaths.nodePath} ${canonicalPaths.serverEntry} --http --port ${port}`;
  if (typeof uid !== "number" || identity.uid !== uid || identity.parentUid !== uid) {
    throw new Error("the AirMCP.app listener is not owned by the current user");
  }
  if (!Number.isSafeInteger(identity.parentPid) || identity.parentPid <= 1) {
    throw new Error("the AirMCP.app listener has no verifiable app parent");
  }
  if (identity.executablePath !== canonicalPaths.nodePath || identity.command !== expectedCommand) {
    throw new Error("the AirMCP.app listener is not the verified bundled runtime");
  }
  if (identity.parentExecutablePath !== canonicalPaths.appExecutable) {
    throw new Error("the AirMCP.app listener was not launched by the verified AirMCP app");
  }
  return identity;
}

export function verifyAppOwnedListener(mcpUrl: string): AppOwnedListenerIdentity {
  const paths = installedAppRuntimePaths(mcpUrl);
  verifyInstalledApp(paths);
  const listeners = listenerProcesses(mcpUrl);
  const [listener] = listeners;
  if (listeners.length !== 1 || !listener) {
    throw new Error(`expected exactly one AirMCP.app listener, found ${listeners.length}`);
  }
  const runtime = processDetails(listener.pid);
  const parent = processDetails(runtime.parentPid);
  const identity = validateAppOwnedListenerIdentity(
    {
      ...runtime,
      parentUid: parent.uid,
      parentExecutablePath: parent.executablePath,
    },
    paths,
  );
  // Verify the running Mach-O images rather than relying only on the bundle
  // currently present on disk. This is defense in depth for path confusion;
  // hostile processes under the same Unix account remain outside this local
  // credential boundary. The response proof below proves possession of the
  // current process-generation secret for each exchange; it does not hash the
  // streamed response body.
  verifyLiveProcessSignature(identity.pid, "node", "AirMCP bundled Node process");
  verifyLiveProcessSignature(identity.parentPid, "app", "AirMCP parent process");
  return identity;
}

export function readPrivateRuntimeCredential(path: string, label: string, uid = process.getuid?.()): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
    if (stat.size < 43 || stat.size > 44) {
      throw new Error(`${label} has an invalid size: ${path}`);
    }
    if (typeof uid === "number" && stat.uid !== uid) {
      throw new Error(`${label} is not owned by the current user: ${path}`);
    }
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`${label} permissions must be 0600, got ${mode.toString(8).padStart(3, "0")}: ${path}`);
    }
    const secret = readFileSync(descriptor, "utf8").trim();
    if (!OWNER_SECRET_RE.test(secret)) throw new Error(`${label} is empty or malformed: ${path}`);
    return secret;
  } catch (error) {
    if (errorCode(error) === "ELOOP") {
      throw new Error(`${label} must not be a symbolic link: ${path}`, { cause: error });
    }
    if (errorCode(error) === "ENOENT") {
      throw new Error(`${label} is missing: ${path}`, { cause: error });
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readPrivateOwnerSecret(path = APP_RUNTIME_OWNER_SECRET_PATH, uid = process.getuid?.()): string {
  return readPrivateRuntimeCredential(path, "app runtime owner secret", uid);
}

export function runtimeIdentityProof(
  ownerSecret: string | undefined,
  nonce: string | undefined,
  pid: number,
  version: string,
): string | undefined {
  const normalized = ownerSecret?.trim();
  if (!normalized || !OWNER_SECRET_RE.test(normalized) || !nonce || !NONCE_RE.test(nonce)) return undefined;
  if (!Number.isSafeInteger(pid) || pid <= 1 || !version) return undefined;
  return createHmac("sha256", normalized)
    .update(`airmcp-app-listener-v1\n${nonce}\n${pid}\n${version}`, "utf8")
    .digest("hex");
}

export function runtimeGenerationBearer(
  ownerSecret: string | undefined,
  pid: number,
  version: string,
): string | undefined {
  const normalized = ownerSecret?.trim();
  if (!normalized || !OWNER_SECRET_RE.test(normalized) || !Number.isSafeInteger(pid) || pid < 2 || !version) {
    return undefined;
  }
  const proof = createHmac("sha256", normalized)
    .update(`airmcp-app-generation-bearer-v1\n${pid}\n${version}`, "utf8")
    .digest("hex");
  return `airmcp_app_${proof}`;
}

export function runtimeResponseProof(
  ownerSecret: string | undefined,
  nonce: string | undefined,
  pid: number,
  version: string,
  method: string,
  pathname: string,
): string | undefined {
  const normalized = ownerSecret?.trim();
  if (
    !normalized ||
    !OWNER_SECRET_RE.test(normalized) ||
    !nonce ||
    !NONCE_RE.test(nonce) ||
    !Number.isSafeInteger(pid) ||
    pid < 2 ||
    !version ||
    !/^[A-Z]+$/.test(method) ||
    pathname !== "/mcp"
  ) {
    return undefined;
  }
  return createHmac("sha256", normalized)
    .update(`airmcp-app-response-v1\n${nonce}\n${pid}\n${version}\n${method}\n${pathname}`, "utf8")
    .digest("hex");
}

interface RuntimeIdentityChallenge {
  status: "ok";
  appOwned: true;
  pid: number;
  version: string;
  proof: string;
  responseProof: typeof APP_RUNTIME_RESPONSE_PROOF_SCHEME;
}

export interface VerifyRuntimeIdentityOptions {
  url: string;
  ownerSecretPath?: string;
  timeoutMs?: number;
  expectedVersion?: string;
}

interface VerifyRuntimeIdentityDependencies {
  fetchImpl?: typeof fetch;
  nonceFactory?: () => string;
  uid?: number;
  verifyListener?: (mcpUrl: string) => AppOwnedListenerIdentity;
}

export interface VerifiedAppRuntimeIdentity {
  challenge: RuntimeIdentityChallenge;
  authorizationToken: string;
  authenticatedFetch: typeof fetch;
}

function sameListener(left: AppOwnedListenerIdentity, right: AppOwnedListenerIdentity): boolean {
  return (
    left.pid === right.pid &&
    left.uid === right.uid &&
    left.executablePath === right.executablePath &&
    left.command === right.command &&
    left.parentPid === right.parentPid &&
    left.parentUid === right.parentUid &&
    left.parentExecutablePath === right.parentExecutablePath
  );
}

function makeAuthenticatedRuntimeFetch(
  mcpUrl: string,
  ownerSecret: string,
  challenge: RuntimeIdentityChallenge,
  fetchImpl: typeof fetch,
): typeof fetch {
  const expected = new URL(mcpUrl);
  expected.search = "";
  expected.hash = "";

  return async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    target.hash = "";
    if (target.href !== expected.href) {
      throw new Error("app runtime authenticated fetch refused a non-canonical MCP target");
    }
    const nonce = randomBytes(32).toString("base64url");
    const headers = new Headers(request.headers);
    headers.set(APP_RUNTIME_REQUEST_NONCE_HEADER, nonce);
    const response = await fetchImpl(new Request(request, { headers }));
    const actualProof = response.headers.get(APP_RUNTIME_RESPONSE_PROOF_HEADER) ?? "";
    const expectedProof = runtimeResponseProof(
      ownerSecret,
      nonce,
      challenge.pid,
      challenge.version,
      request.method.toUpperCase(),
      target.pathname,
    );
    const actualBytes = Buffer.from(actualProof, "hex");
    const expectedBytes = Buffer.from(expectedProof ?? "", "hex");
    if (
      !PROOF_RE.test(actualProof) ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      await response.body?.cancel();
      throw new Error("app runtime MCP response proof is missing or invalid");
    }
    return response;
  };
}

function identityChallengeUrl(mcpUrl: string, nonce: string): URL {
  const url = new URL(mcpUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("app runtime identity challenge requires the canonical http://127.0.0.1/.../mcp URL");
  }
  url.pathname = APP_IDENTITY_CHALLENGE_PATH;
  url.search = "";
  url.hash = "";
  url.searchParams.set("nonce", nonce);
  return url;
}

export async function verifyRuntimeIdentityChallenge(
  options: VerifyRuntimeIdentityOptions,
  dependencies: VerifyRuntimeIdentityDependencies = {},
): Promise<VerifiedAppRuntimeIdentity> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nonce = (dependencies.nonceFactory ?? (() => randomBytes(32).toString("base64url")))();
  if (!NONCE_RE.test(nonce)) throw new Error("app runtime identity challenge nonce is malformed");

  const challengeUrl = identityChallengeUrl(options.url, nonce);
  const listenerIdentity = (dependencies.verifyListener ?? verifyAppOwnedListener)(options.url);
  const ownerSecret = readPrivateOwnerSecret(options.ownerSecretPath, dependencies.uid ?? process.getuid?.());
  const response = await fetchImpl(challengeUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 1_000),
  });
  if (!response.ok) throw new Error(`app runtime identity challenge returned HTTP ${response.status}`);

  const value: unknown = await response.json();
  const challenge = value as Partial<RuntimeIdentityChallenge>;
  if (
    challenge.status !== "ok" ||
    challenge.appOwned !== true ||
    !Number.isSafeInteger(challenge.pid) ||
    (challenge.pid ?? 0) < 2 ||
    challenge.pid !== listenerIdentity.pid ||
    typeof challenge.version !== "string" ||
    challenge.version.length === 0 ||
    (options.expectedVersion !== undefined && challenge.version !== options.expectedVersion) ||
    typeof challenge.proof !== "string" ||
    !PROOF_RE.test(challenge.proof) ||
    challenge.responseProof !== APP_RUNTIME_RESPONSE_PROOF_SCHEME
  ) {
    throw new Error("app runtime identity challenge did not match the expected app-owned runtime");
  }

  const complete = challenge as RuntimeIdentityChallenge;
  const expectedProof = runtimeIdentityProof(ownerSecret, nonce, complete.pid, complete.version);
  const expectedBytes = Buffer.from(expectedProof ?? "", "hex");
  const actualBytes = Buffer.from(complete.proof, "hex");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("app runtime identity challenge proof is invalid");
  }
  const authorizationToken = runtimeGenerationBearer(ownerSecret, complete.pid, complete.version);
  if (!authorizationToken) throw new Error("app runtime generation authorization inputs are invalid");
  const confirmedListener = (dependencies.verifyListener ?? verifyAppOwnedListener)(options.url);
  if (!sameListener(listenerIdentity, confirmedListener)) {
    throw new Error("the AirMCP.app listener changed during identity verification");
  }
  return {
    challenge: complete,
    authorizationToken,
    authenticatedFetch: makeAuthenticatedRuntimeFetch(options.url, ownerSecret, complete, fetchImpl),
  };
}
