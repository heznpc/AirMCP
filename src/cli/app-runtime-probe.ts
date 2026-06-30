import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface AppRuntimeProbeOptions {
  url: string;
  token: string;
  clientName?: string;
  clientVersion?: string;
  timeoutMs?: number;
  minTools?: number;
  requiredTools?: string[];
}

export interface AppRuntimeProbeResult {
  serverName?: string;
  serverVersion?: string;
  toolCount: number;
  sampleTools: string[];
}

export async function probeAppRuntimeMcp(options: AppRuntimeProbeOptions): Promise<AppRuntimeProbeResult> {
  const timeout = options.timeoutMs ?? 3_000;
  const minTools = options.minTools ?? 1;
  const client = new Client(
    {
      name: options.clientName ?? "airmcp-runtime-probe",
      version: options.clientVersion ?? "0",
    },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${options.token}`,
      },
    },
  });

  try {
    await client.connect(transport, { timeout });
    const tools = await client.listTools(undefined, { timeout });
    const toolCount = tools.tools.length;
    if (toolCount < minTools) {
      throw new Error(`tools/list returned ${toolCount} tools; expected at least ${minTools}`);
    }
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    const missing = (options.requiredTools ?? []).filter((name) => !toolNames.has(name));
    if (missing.length > 0) {
      throw new Error(`tools/list missing required tools: ${missing.join(", ")}`);
    }
    const serverVersion = client.getServerVersion();
    return {
      serverName: serverVersion?.name,
      serverVersion: serverVersion?.version,
      toolCount,
      sampleTools: tools.tools.slice(0, 5).map((tool) => tool.name),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
