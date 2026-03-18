import type { McpServer } from "./mcp.js";
import type { AirMcpConfig } from "./config.js";

export interface ModuleRegistration {
  name: string;
  tools: (server: McpServer, config: AirMcpConfig) => void;
  prompts?: (server: McpServer) => void;
  /** Minimum macOS version required for this module (e.g. 26 for macOS 26+). */
  minMacosVersion?: number;
}
