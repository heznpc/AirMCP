import type { McpServer } from "./mcp.js";
import type { AirMcpConfig } from "./config.js";
import type { ModuleCompatibility } from "./compatibility.js";

export interface ModuleRegistration {
  name: string;
  tools: (server: McpServer, config: AirMcpConfig) => void;
  prompts?: (server: McpServer) => void;
  /** Minimum macOS version required for this module (e.g. 26 for macOS 26+). */
  minMacosVersion?: number;
  /** Full compatibility manifest per RFC 0004. */
  compatibility?: ModuleCompatibility;
  /** DLC-like module pack this module belongs to. */
  pack?: string;
}
