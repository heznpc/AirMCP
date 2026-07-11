/**
 * HTTP-facing OAuth helpers shared by the Streamable HTTP transport.
 *
 * The JWT verifier decides whether a token is authentic. This module owns the
 * next boundary: binding an authenticated principal to an MCP session and
 * translating tool-scope decisions into RFC 6750 / MCP HTTP challenges.
 */

import type { OAuthClaims } from "../shared/request-context.js";
import { callerSatisfies, evaluateScopeGate, type ScopeRequirement } from "../shared/oauth-scope.js";

export interface OAuthSessionPrincipal {
  subject: string;
  /** OAuth client identifier. RFC 9068 uses `client_id`; some OIDC issuers
   *  expose the equivalent authorized party as `azp`. */
  clientId?: string;
}

interface ToolDetailsLookup {
  getToolDetails(name: string):
    | {
        readOnly?: boolean;
        destructive?: boolean;
      }
    | undefined;
}

interface JsonRpcRequest {
  method?: unknown;
  params?: unknown;
}

const SCOPE_ORDER: readonly ScopeRequirement[] = ["mcp:read", "mcp:write", "mcp:destructive", "mcp:admin"];

export function toOAuthSessionPrincipal(claims: OAuthClaims | undefined): OAuthSessionPrincipal | undefined {
  if (!claims) return undefined;
  return {
    subject: claims.subject,
    ...(claims.clientId ? { clientId: claims.clientId } : {}),
  };
}

/** A session may survive access-token refresh, but it must never move between
 *  subjects or OAuth clients. Comparing the stable `(sub, client_id)` pair
 *  permits refresh while preventing cross-principal session-ID reuse. */
export function isSameOAuthSessionPrincipal(
  bound: OAuthSessionPrincipal | undefined,
  current: OAuthSessionPrincipal | undefined,
): boolean {
  if (!bound || !current) return bound === current;
  return bound.subject === current.subject && bound.clientId === current.clientId;
}

function asRequests(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) return body.filter((item): item is JsonRpcRequest => !!item && typeof item === "object");
  if (body && typeof body === "object") return [body as JsonRpcRequest];
  return [];
}

function toolNameFrom(request: JsonRpcRequest): string | null {
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object") return null;
  const name = (request.params as Record<string, unknown>).name;
  return typeof name === "string" && name !== "" ? name : null;
}

function isResourceOperation(request: JsonRpcRequest): boolean {
  return typeof request.method === "string" && request.method.startsWith("resources/");
}

/**
 * Return every scope missing from protected MCP operations carried by one
 * HTTP request. Resource methods can expose Apple app data without traversing
 * ToolRegistry, so every `resources/*` request requires the cumulative
 * `mcp:read` capability. Unknown tools stay with the MCP dispatcher so this
 * preflight cannot turn a normal "tool not found" error into an authorization
 * oracle.
 */
export function missingScopesForMcpRequest(
  body: unknown,
  registry: ToolDetailsLookup,
  claims: OAuthClaims,
): ScopeRequirement[] {
  const missing = new Set<ScopeRequirement>();
  for (const request of asRequests(body)) {
    if (isResourceOperation(request) && !callerSatisfies("mcp:read", claims.scopes)) {
      missing.add("mcp:read");
    }
    const name = toolNameFrom(request);
    if (!name) continue;
    const details = registry.getToolDetails(name);
    if (!details) continue;
    const decision = evaluateScopeGate({
      toolName: name,
      isReadOnly: details.readOnly === true,
      isDestructive: details.destructive === true,
      callerScopes: claims.scopes,
    });
    if (!decision.allowed && decision.missing) missing.add(decision.missing);
  }
  return SCOPE_ORDER.filter((scope) => missing.has(scope));
}

/** RFC 8414 / RFC 9728 path insertion. For an identifier such as
 *  `https://example.com/tenant`, the metadata path is
 *  `/.well-known/<suffix>/tenant`, not `/tenant/.well-known/<suffix>`. */
export function wellKnownPath(identifier: string, suffix: string): string {
  const url = new URL(identifier);
  const identifierPath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `/.well-known/${suffix}${identifierPath}`;
}

export function wellKnownUrl(identifier: string, suffix: string): string {
  const url = new URL(identifier);
  url.pathname = wellKnownPath(identifier, suffix);
  url.hash = "";
  return url.toString();
}

function quoteAuthParam(value: string): string {
  // Header values are configuration- or server-derived, but strip CR/LF as a
  // final response-splitting guard before quoted-string escaping.
  return `"${value
    .replace(/[\r\n]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

export interface BearerChallengeInput {
  resourceMetadata: string;
  error?: "invalid_request" | "invalid_token" | "insufficient_scope";
  scopes?: readonly string[];
  errorDescription?: string;
}

/** Build a Bearer challenge using RFC 6750 auth-params plus RFC 9728's
 *  `resource_metadata` pointer. */
export function buildBearerChallenge(input: BearerChallengeInput): string {
  const params: string[] = [`resource_metadata=${quoteAuthParam(input.resourceMetadata)}`];
  if (input.error) params.unshift(`error=${quoteAuthParam(input.error)}`);
  if (input.scopes && input.scopes.length > 0) params.push(`scope=${quoteAuthParam(input.scopes.join(" "))}`);
  if (input.errorDescription) params.push(`error_description=${quoteAuthParam(input.errorDescription)}`);
  return `Bearer ${params.join(", ")}`;
}
