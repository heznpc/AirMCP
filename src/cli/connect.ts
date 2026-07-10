import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { IDENTITY } from "../shared/constants.js";

const DEFAULT_URL = `http://127.0.0.1:${IDENTITY.HTTP_PORT}/mcp`;
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
    "and waits for its runtime instead of launching a second server.",
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

export function shouldAutoLaunchApp(url: string): boolean {
  if (process.env.AIRMCP_CONNECT_NO_LAUNCH === "1" || process.platform !== "darwin") return false;
  const parsed = new URL(url);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  return loopback && Number(parsed.port || "80") === IDENTITY.HTTP_PORT && parsed.pathname === "/mcp";
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

  const bundleId = process.env.AIRMCP_APP_BUNDLE_ID ?? "com.heznpc.AirMCP";
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

export async function runConnect(args = process.argv.slice(3)): Promise<void> {
  const options = parseArgs(args);
  try {
    await launchLocalAppAndWait(options.url);
  } catch (error) {
    console.error(`[AirMCP connect] ${error instanceof Error ? error.message : String(error)}`);
  }
  const stdio = new StdioServerTransport();
  const requestInit: RequestInit = options.token ? { headers: { Authorization: `Bearer ${options.token}` } } : {};
  const http = new StreamableHTTPClientTransport(new URL(options.url), { requestInit });
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
