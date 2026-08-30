import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { APP_RUNTIME_OWNER_SECRET_PATH, verifyRuntimeIdentityChallenge } from "../shared/app-runtime-identity.js";

// The native app owns one fixed local endpoint. General HTTP server launches
// may still honor AIRMCP_HTTP_PORT, but that operator override must never
// redefine which URL receives the app-identity handshake instead of the
// configured persistent bearer.
export const APP_OWNED_HTTP_PORT = 3847;
const DEFAULT_URL = `http://127.0.0.1:${APP_OWNED_HTTP_PORT}/mcp`;
const INITIALIZE_METHOD = "initialize";

interface ConnectOptions {
  url: string;
  token?: string;
}

function usage(): string {
  return [
    "Usage: npx airmcp connect [--url http://127.0.0.1:3847/mcp] [--token <token>]",
    "",
    "Connect a stdio-only MCP client to the AirMCP.app-owned local HTTP runtime.",
    "For the default loopback URL, this command launches AirMCP.app on demand",
    "and waits for its runtime instead of launching a second server. It verifies",
    "the signed app child, derives a generation bearer, and verifies fresh",
    "runtime-possession proof on every MCP response. The persistent token is",
    "never forwarded to the canonical listener.",
  ].join("\n");
}

function parseArgs(args: string[]): ConnectOptions {
  let url = process.env.AIRMCP_CONNECT_URL ?? DEFAULT_URL;
  let token = process.env.AIRMCP_HTTP_TOKEN || undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--url") {
      const value = args[i + 1];
      if (!value) throw new Error("--url requires a value");
      url = value;
      i += 1;
      continue;
    }
    if (arg === "--token") {
      const value = args[i + 1];
      if (!value) throw new Error("--token requires a value");
      token = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown connect option: ${arg}`);
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("URL must use http:// or https://");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --url: ${reason}`, { cause: error });
  }

  return { url, token };
}

function isRequest(message: JSONRPCMessage): message is JSONRPCMessage & { id: RequestId; method: string } {
  return "method" in message && "id" in message && message.id !== undefined;
}

function isResponse(message: JSONRPCMessage): message is JSONRPCMessage & { id: RequestId; result?: unknown } {
  return "id" in message && message.id !== undefined && ("result" in message || "error" in message);
}

function protocolVersionFrom(message: JSONRPCMessage): string | undefined {
  if (!isResponse(message) || typeof message.result !== "object" || message.result === null) return undefined;
  const result = message.result as Record<string, unknown>;
  return typeof result.protocolVersion === "string" ? result.protocolVersion : undefined;
}

function makeProxyUnavailableResponse(message: JSONRPCMessage, error: unknown): JSONRPCMessage | null {
  if (!isRequest(message)) return null;
  const detail = error instanceof Error ? error.message : String(error);
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32000,
      message: "AirMCP.app local runtime is not reachable. Start AirMCP.app and make sure its server is running.",
      data: { detail },
    },
  };
}

export function isCanonicalAppOwnedEndpoint(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === "http:" &&
    parsed.hostname === "127.0.0.1" &&
    Number(parsed.port || "80") === APP_OWNED_HTTP_PORT &&
    parsed.pathname === "/mcp" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === ""
  );
}

function isReservedAppOwnedHttpPort(url: string): boolean {
  const parsed = new URL(url);
  // Reserve the entire cleartext app port, not just familiar loopback spellings.
  // WHATWG URLs admit aliases such as localhost., 127/8, IPv4-mapped IPv6,
  // numeric IPv4, and hostnames resolved through /etc/hosts. Treating any of
  // those as a custom endpoint would forward the persistent configured bearer
  // before the canonical app-child verification runs.
  return parsed.protocol === "http:" && Number(parsed.port || "80") === APP_OWNED_HTTP_PORT;
}

export function shouldAutoLaunchApp(url: string): boolean {
  if (process.env.AIRMCP_CONNECT_NO_LAUNCH === "1" || process.platform !== "darwin") return false;
  return isCanonicalAppOwnedEndpoint(url);
}

async function healthReady(mcpUrl: string): Promise<boolean> {
  const health = new URL("/health", mcpUrl);
  try {
    const response = await fetch(health, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown; version?: unknown };
    return body.status === "ok" && typeof body.version === "string";
  } catch {
    return false;
  }
}

async function launchLocalAppAndWait(mcpUrl: string): Promise<void> {
  if (!shouldAutoLaunchApp(mcpUrl) || (await healthReady(mcpUrl))) return;

  const bundleId = process.env.AIRMCP_APP_BUNDLE_ID ?? "app.airmcp";
  const launcher = spawn("/usr/bin/open", ["-b", bundleId], {
    detached: true,
    stdio: "ignore",
  });
  launcher.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await healthReady(mcpUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AirMCP.app launched but its local runtime did not become ready at ${mcpUrl}`);
}

interface ConnectAuthorizationDependencies {
  verifyIdentity?: typeof verifyRuntimeIdentityChallenge;
  ownerSecretPath?: string;
}

interface ConnectAuthorization {
  authorizationToken?: string;
  authenticatedFetch?: typeof fetch;
}

export async function resolveConnectAuthorization(
  url: string,
  configuredToken: string | undefined,
  dependencies: ConnectAuthorizationDependencies = {},
): Promise<ConnectAuthorization> {
  if (!isCanonicalAppOwnedEndpoint(url)) {
    if (isReservedAppOwnedHttpPort(url)) {
      throw new Error("the reserved AirMCP.app HTTP port accepts only the canonical 127.0.0.1 /mcp endpoint");
    }
    return { authorizationToken: configuredToken };
  }
  const verifyIdentity = dependencies.verifyIdentity ?? verifyRuntimeIdentityChallenge;
  const receipt = await verifyIdentity({
    url,
    ownerSecretPath: dependencies.ownerSecretPath ?? APP_RUNTIME_OWNER_SECRET_PATH,
    timeoutMs: 1_000,
  });
  return {
    authorizationToken: receipt.authorizationToken,
    authenticatedFetch: receipt.authenticatedFetch,
  };
}

export async function resolveConnectAuthorizationToken(
  url: string,
  configuredToken: string | undefined,
  dependencies: ConnectAuthorizationDependencies = {},
): Promise<string | undefined> {
  return (await resolveConnectAuthorization(url, configuredToken, dependencies)).authorizationToken;
}

export async function runConnect(args = process.argv.slice(3)): Promise<void> {
  const options = parseArgs(args);
  let authorization: ConnectAuthorization;
  try {
    await launchLocalAppAndWait(options.url);
    authorization = await resolveConnectAuthorization(options.url, options.token);
  } catch (error) {
    console.error(`[AirMCP connect] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  const authorizationToken = authorization.authorizationToken;
  const stdio = new StdioServerTransport();
  const requestInit: RequestInit = authorizationToken
    ? { headers: { Authorization: `Bearer ${authorizationToken}` } }
    : {};
  const http = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit,
    ...(authorization.authenticatedFetch ? { fetch: authorization.authenticatedFetch } : {}),
  });
  const initializeRequestIds = new Set<RequestId>();
  const keepAlive = setInterval(() => {}, 60_000);
  let closing = false;
  let resolveDone: (exitCode: number) => void = () => {};
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  async function closeBoth(exitCode = 0): Promise<void> {
    if (closing) return;
    closing = true;
    clearInterval(keepAlive);
    await Promise.allSettled([stdio.close(), http.close()]);
    resolveDone(exitCode);
  }

  stdio.onerror = (error) => {
    console.error(`[AirMCP connect] stdio error: ${error.message}`);
  };
  http.onerror = (error) => {
    console.error(`[AirMCP connect] HTTP transport error: ${error.message}`);
  };
  stdio.onclose = () => {
    void closeBoth(0);
  };
  http.onclose = () => {
    void closeBoth(0);
  };
  process.once("SIGINT", () => {
    void closeBoth(130);
  });
  process.once("SIGTERM", () => {
    void closeBoth(143);
  });
  process.stdin.once("end", () => {
    void closeBoth(0);
  });
  process.stdin.once("close", () => {
    void closeBoth(0);
  });

  stdio.onmessage = (message) => {
    if (isRequest(message) && message.method === INITIALIZE_METHOD) {
      initializeRequestIds.add(message.id);
    }
    http.send(message).catch((error: unknown) => {
      console.error(`[AirMCP connect] failed to forward to ${options.url}: ${String(error)}`);
      const response = makeProxyUnavailableResponse(message, error);
      if (response) {
        void stdio.send(response).finally(() => closeBoth(1));
      } else {
        void closeBoth(1);
      }
    });
  };

  http.onmessage = (message) => {
    if (isResponse(message) && initializeRequestIds.delete(message.id)) {
      const protocolVersion = protocolVersionFrom(message);
      if (protocolVersion) http.setProtocolVersion?.(protocolVersion);
    }
    void stdio.send(message);
  };

  await http.start();
  await stdio.start();
  process.stdin.resume();
  process.exitCode = await done;
}
