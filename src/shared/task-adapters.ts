import type { AirMcpConfig } from "./config.js";
import type { ToolDescriptionMode } from "./tool-registry.js";

export const HARNESS_ADAPTER_NAMES = ["compatible", "strict", "app-runtime", "agent"] as const;
export type HarnessAdapterName = (typeof HARNESS_ADAPTER_NAMES)[number];

export interface HarnessAdapterPolicy {
  name: HarnessAdapterName;
  requireSessionForHiddenTools: boolean;
  maxSessionTools: number;
  defaultSessionTtlSeconds: number;
  maxSessionTtlSeconds: number;
  discoveryDescriptionMode: ToolDescriptionMode;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeAdapter(raw: string | undefined): HarnessAdapterName | null {
  if (!raw) return null;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if ((HARNESS_ADAPTER_NAMES as readonly string[]).includes(normalized)) return normalized as HarnessAdapterName;
  if (normalized === "app") return "app-runtime";
  return null;
}

export function resolveHarnessAdapter(config: AirMcpConfig): HarnessAdapterPolicy {
  const configured = normalizeAdapter(process.env.AIRMCP_HARNESS_ADAPTER);
  const inferred: HarnessAdapterName = process.env.AIRMCP_APP_OWNED_RUNTIME
    ? "app-runtime"
    : config.requireToolSession
      ? "strict"
      : "compatible";
  const name = configured ?? inferred;
  const strict = name !== "compatible";
  const maxSessionTtlSeconds = envInt("AIRMCP_TOOL_SESSION_MAX_TTL_SECONDS", 3600, 30, 3600);
  const defaultSessionTtlSeconds = Math.min(
    envInt("AIRMCP_TOOL_SESSION_DEFAULT_TTL_SECONDS", 900, 30, 3600),
    maxSessionTtlSeconds,
  );

  return {
    name,
    requireSessionForHiddenTools: strict || config.requireToolSession,
    maxSessionTools: envInt("AIRMCP_TOOL_SESSION_MAX_TOOLS", 64, 1, 64),
    defaultSessionTtlSeconds,
    maxSessionTtlSeconds,
    discoveryDescriptionMode: "summary",
  };
}
