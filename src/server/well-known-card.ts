/**
 * `.well-known/mcp.json` — MCP Server Card builder.
 *
 * Pure function that assembles the discovery card served at
 * `/.well-known/mcp.json`. Lives in its own module so the card shape
 * can be unit-tested without spinning up an Express server.
 *
 * Registry crawlers (Anthropic MCP Registry, Smithery, PulseMCP,
 * Glama) hit this endpoint to build their catalog. Beyond the MCP
 * spec minimum (2025-11-25: name, version, transport, capabilities),
 * AirMCP adds:
 *   - `tools: { count, names[] }` — full tool inventory so crawlers
 *     can surface the surface area without opening a session
 *   - `modules[]` — the enabled module list for this host (depends
 *     on config + OS compatibility gates)
 *   - `license` / `homepage` — standard registry metadata
 *   - `schema_version` — pins the spec revision the card conforms to
 *   - `network_policy` + `allowed_origins` — from RFC 0002 so
 *     Managed Agents can reason about exposure before connecting
 */

// Kept as an inline union instead of importing AllowNetwork from
// http-transport.ts so this module stays free of Express / MCP SDK
// dependencies — tests can load it without mocking either.
type AllowNetwork = "loopback-only" | "with-token" | "with-token+origin" | "unauthenticated";

export interface ServerCardInput {
  /** npm package name, used as the card's primary identifier. */
  name: string;
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
  websiteUrl: string;
  /** Full icon descriptor per MCP spec — `{ src, mimeType, sizes }`
   *  or a bare data/https URL. Embedded verbatim into `icons[]`. */
  icon: string | { src: string; mimeType?: string; sizes?: string[] };
  httpToken?: string;
  allowNetwork: AllowNetwork;
  allowedOrigins: string[];
  tools: { count: number; names: string[] };
  modules: string[];
}

/** MCP spec revision this card shape conforms to. Bumped when the
 *  published spec changes its top-level contract.  */
export const SCHEMA_VERSION = "2025-11-25" as const;

export function buildServerCard(input: ServerCardInput): Record<string, unknown> {
  const card: Record<string, unknown> = {
    name: input.name,
    version: input.version,
    schema_version: SCHEMA_VERSION,
    websiteUrl: input.websiteUrl,
    icons: [input.icon],
    transport: { type: "streamable-http", url: "/mcp" },
    capabilities: {
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true },
    },
    network_policy: input.allowNetwork,
    tools: {
      count: input.tools.count,
      names: input.tools.names,
    },
    modules: input.modules,
  };

  // Optional fields — only emit when present so the card stays tight
  // on stdio-first deployments where most of this is absent.
  if (input.description) card.description = input.description;
  if (input.license) card.license = input.license;
  if (input.homepage) card.homepage = input.homepage;
  if (input.httpToken) card.authorization = { type: "bearer" };
  if (input.allowedOrigins.length > 0) card.allowed_origins = input.allowedOrigins;
  if (input.allowNetwork === "unauthenticated") card.security = "insecure";

  return card;
}
