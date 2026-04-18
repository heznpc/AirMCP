import type { McpServer } from "./mcp.js";
import type { AirMcpConfig } from "./config.js";
import type { ModuleCompatibility } from "./compatibility.js";

export interface ModuleRegistration {
  name: string;
  tools: (server: McpServer, config: AirMcpConfig) => void;
  prompts?: (server: McpServer) => void;
  /**
   * Minimum macOS version required for this module (e.g. 26 for macOS 26+).
   *
   * Retained as a top-level field for backward compat with the existing
   * runtime check in `src/server/mcp-setup.ts`. New manifest entries should
   * prefer `compatibility.minMacosVersion` which also carries status,
   * deprecation, hardware requirements, etc. (see RFC 0004).
   */
  minMacosVersion?: number;
  /**
   * Full compatibility manifest per RFC 0004. Optional — omitting it is
   * equivalent to `{ status: "stable" }` with no constraints.
   *
   * The existing runtime does NOT yet consult this field; its presence
   * is purely informational today, threaded through for future use by
   * `resolveModuleCompatibility()`.
   */
  compatibility?: ModuleCompatibility;
}
