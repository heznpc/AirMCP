#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const IDENTITY_PROOF_DOMAIN = "airmcp-app-listener-v1";
const REQUEST_NONCE_HEADER = "x-airmcp-runtime-nonce";
const RESPONSE_PROOF_HEADER = "x-airmcp-runtime-proof";
const RESPONSE_PROOF_SCHEME = "hmac-sha256-v1";

function usage() {
  return [
    "Usage: node scripts/probe-app-runtime.mjs --url http://127.0.0.1:3847/mcp --owner-secret-file <owner-only-file>",
    "",
    "Authenticates the app-owned listener with its owner-secret challenge, derives a",
    "generation-scoped bearer, then performs a real MCP initialize + tools/list round trip.",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = {
    url: "",
    ownerSecretFile: "",
    expectedVersion: PACKAGE_VERSION,
    timeoutMs: 5_000,
    minTools: 1,
    clientName: "airmcp-bundle-verify",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--url") {
      options.url = argv[++i] ?? "";
      continue;
    }
    if (arg === "--owner-secret-file") {
      options.ownerSecretFile = argv[++i] ?? "";
      continue;
    }
    if (arg === "--expected-version") {
      options.expectedVersion = argv[++i] ?? "";
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i] ?? "");
      continue;
    }
    if (arg === "--min-tools") {
      options.minTools = Number(argv[++i] ?? "");
      continue;
    }
    if (arg === "--client-name") {
      options.clientName = argv[++i] ?? "";
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  if (!options.url) throw new Error("--url is required");
  if (!options.ownerSecretFile) throw new Error("--owner-secret-file is required");
  if (!options.expectedVersion) throw new Error("--expected-version must not be empty");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isInteger(options.minTools) || options.minTools < 1) {
    throw new Error("--min-tools must be a positive integer");
  }
  return options;
}

function readPrivateCredential(path, label, pattern, uid = process.getuid?.()) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
    if (typeof uid === "number" && stat.uid !== uid) {
      throw new Error(`${label} is not owned by the current user: ${path}`);
    }
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`${label} permissions must be 0600, got ${mode.toString(8).padStart(3, "0")}: ${path}`);
    }
    const value = readFileSync(descriptor, "utf8").trim();
    if (!pattern.test(value)) throw new Error(`${label} is empty or malformed: ${path}`);
    return value;
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error(`${label} must not be a symbolic link: ${path}`, { cause: error });
    }
    if (error?.code === "ENOENT") throw new Error(`${label} is missing: ${path}`, { cause: error });
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readPrivateToken(path, uid = process.getuid?.()) {
  return readPrivateCredential(path, "app runtime token", /^[A-Za-z0-9_-]{32,}$/, uid);
}

export function readPrivateOwnerSecret(path, uid = process.getuid?.()) {
  return readPrivateCredential(path, "app runtime owner secret", /^[A-Za-z0-9_-]{43}$/, uid);
}

export function runtimeIdentityProof(ownerSecret, nonce, pid, version) {
  return createHmac("sha256", ownerSecret)
    .update(`${IDENTITY_PROOF_DOMAIN}\n${nonce}\n${pid}\n${version}`, "utf8")
    .digest("hex");
}

export function runtimeGenerationBearer(ownerSecret, pid, version) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ownerSecret) || !Number.isSafeInteger(pid) || pid < 2 || !version) {
    throw new Error("app runtime generation authorization inputs are invalid");
  }
  const proof = createHmac("sha256", ownerSecret)
    .update(`airmcp-app-generation-bearer-v1\n${pid}\n${version}`, "utf8")
    .digest("hex");
  return `airmcp_app_${proof}`;
}

export function runtimeResponseProof(ownerSecret, nonce, pid, version, method, pathname) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(ownerSecret) ||
    !/^[A-Za-z0-9_-]{32,64}$/.test(nonce ?? "") ||
    !Number.isSafeInteger(pid) ||
    pid < 2 ||
    !version ||
    !/^[A-Z]+$/.test(method) ||
    pathname !== "/mcp"
  ) {
    throw new Error("app runtime response proof inputs are invalid");
  }
  return createHmac("sha256", ownerSecret)
    .update(`airmcp-app-response-v1\n${nonce}\n${pid}\n${version}\n${method}\n${pathname}`, "utf8")
    .digest("hex");
}

function authenticatedRuntimeFetch(mcpUrl, ownerSecret, challenge, fetchImpl) {
  const expected = new URL(mcpUrl);
  expected.search = "";
  expected.hash = "";
  return async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    target.hash = "";
    if (target.href !== expected.href) throw new Error("runtime probe refused a non-canonical MCP target");
    const nonce = randomBytes(32).toString("base64url");
    const headers = new Headers(request.headers);
    headers.set(REQUEST_NONCE_HEADER, nonce);
    const response = await fetchImpl(new Request(request, { headers }));
    const actual = response.headers.get(RESPONSE_PROOF_HEADER) ?? "";
    const expectedProof = runtimeResponseProof(
      ownerSecret,
      nonce,
      challenge.pid,
      challenge.version,
      request.method.toUpperCase(),
      target.pathname,
    );
    const actualBytes = Buffer.from(actual, "hex");
    const expectedBytes = Buffer.from(expectedProof, "hex");
    if (
      !/^[0-9a-f]{64}$/.test(actual) ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      await response.body?.cancel();
      throw new Error("app runtime MCP response proof is missing or invalid");
    }
    return response;
  };
}

function appIdentityChallengeUrl(mcpUrl, nonce) {
  const url = new URL(mcpUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("--url must use the app-owned http://127.0.0.1 listener");
  }
  url.pathname = "/app/identity-challenge";
  url.search = "";
  url.hash = "";
  url.searchParams.set("nonce", nonce);
  return url;
}

export async function verifyRuntimeIdentityChallenge(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nonce = (dependencies.nonceFactory ?? (() => randomBytes(32).toString("base64url")))();
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error("identity challenge nonce is malformed");

  const ownerSecret = readPrivateOwnerSecret(options.ownerSecretFile, dependencies.uid ?? process.getuid?.());
  const response = await fetchImpl(appIdentityChallengeUrl(options.url, nonce), {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`app runtime identity challenge returned HTTP ${response.status}`);

  const challenge = await response.json();
  if (
    challenge?.status !== "ok" ||
    challenge?.appOwned !== true ||
    !Number.isSafeInteger(challenge?.pid) ||
    challenge.pid < 2 ||
    challenge?.version !== options.expectedVersion ||
    !/^[0-9a-f]{64}$/.test(challenge?.proof ?? "") ||
    challenge?.responseProof !== RESPONSE_PROOF_SCHEME
  ) {
    throw new Error("app runtime identity challenge did not match the expected app-owned runtime");
  }

  const expectedProof = Buffer.from(runtimeIdentityProof(ownerSecret, nonce, challenge.pid, challenge.version), "hex");
  const actualProof = Buffer.from(challenge.proof, "hex");
  if (actualProof.length !== expectedProof.length || !timingSafeEqual(actualProof, expectedProof)) {
    throw new Error("app runtime identity challenge proof is invalid");
  }
  return {
    challenge,
    authorizationToken: runtimeGenerationBearer(ownerSecret, challenge.pid, challenge.version),
    authenticatedFetch: authenticatedRuntimeFetch(options.url, ownerSecret, challenge, fetchImpl),
  };
}

export async function probeAppRuntime(options) {
  // This authorization is scoped to the challenged listener generation. It
  // cannot authenticate to the replacement process after the app rotates the
  // owner secret, even if the port changes hands before this HTTP connection.
  const receipt = await verifyRuntimeIdentityChallenge(options);
  const client = new Client({ name: options.clientName, version: "0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${receipt.authorizationToken}`,
      },
    },
    fetch: receipt.authenticatedFetch,
  });

  try {
    await client.connect(transport, { timeout: options.timeoutMs });
    const result = await client.listTools(undefined, { timeout: options.timeoutMs });
    if (result.tools.length < options.minTools) {
      throw new Error(`tools/list returned ${result.tools.length} tools; expected at least ${options.minTools}`);
    }
    const server = client.getServerVersion();
    const name = server?.name ?? "unknown";
    const version = server?.version ?? "unknown";
    return `${result.tools.length} tools from ${name} v${version} (listener pid ${receipt.challenge.pid})`;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(await probeAppRuntime(options));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
