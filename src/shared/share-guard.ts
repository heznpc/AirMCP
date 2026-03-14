import type { AirMcpConfig } from "./config.js";
import { needsShareApproval } from "./config.js";
import type { HitlClient } from "./hitl.js";

interface Shareable {
  shared: boolean;
}

/**
 * Shared HITL client reference — set once at startup from index.ts.
 * Modules import this to check if HITL-based share approval is available.
 */
let sharedHitlClient: HitlClient | null = null;

export function setShareGuardHitlClient(client: HitlClient | null): void {
  sharedHitlClient = client;
}

/**
 * Filter a list of items, removing shared ones when access is not allowed.
 *
 * Policy:
 * 1. If `includeShared` is true AND no share-approval is configured for the module → include all
 * 2. If share-approval is configured for the module → include shared items (they'll be guarded on mutation)
 * 3. Otherwise (includeShared=false, no share-approval) → strip shared items
 */
export function filterSharedAccess<T extends Shareable>(
  items: T[],
  config: AirMcpConfig,
  moduleName: string,
): T[] {
  if (config.includeShared) return items;
  if (needsShareApproval(config, moduleName)) return items;
  return items.filter((item) => !item.shared);
}

/**
 * Guard access to a single shared item before a mutation.
 *
 * Returns an error message string if access is denied, or null if access is allowed.
 *
 * Policy:
 * 1. If `includeShared` is true → allow (null)
 * 2. If item is not shared → allow (null)
 * 3. If share-approval is configured for the module:
 *    a. HITL client available → request approval via socket, deny if not approved
 *    b. HITL client NOT available → deny (same as includeShared=false)
 * 4. Otherwise → deny with the standard includeShared message
 */
export async function guardSharedAccess(
  isShared: boolean,
  config: AirMcpConfig,
  moduleName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  // Always allow if includeShared is on
  if (config.includeShared) return null;
  // Not shared — nothing to guard
  if (!isShared) return null;

  // Check if share-approval is configured for this module
  if (needsShareApproval(config, moduleName)) {
    if (sharedHitlClient) {
      const approved = await sharedHitlClient.requestApproval(
        toolName,
        { ...args, _shareApproval: true },
        false, // not inherently destructive — the tool's own HITL handles that
        false,
      );
      if (approved) return null;
      return `Action denied: "${toolName}" requires share approval for shared items. The user denied or did not respond in time.`;
    }
    // No HITL client — deny access (cannot get approval without the socket)
    return `This ${moduleName} item is shared. Share approval is configured but the HITL approval channel is not available. Enable HITL (set hitl.level to any value other than "off") or set includeShared=true to allow.`;
  }

  // Default: deny shared access
  return `This ${moduleName} item is shared. Modifying shared items is disabled by default. Set AIRMCP_INCLUDE_SHARED=true to allow.`;
}
