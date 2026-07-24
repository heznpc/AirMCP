/**
 * Server metadata constants — icon and website URL used in MCP initialize
 * response and .well-known/mcp.json discovery endpoint.
 */

/** Single source of truth for project website URL (also in IDENTITY.WEBSITE_URL). */
export const WEBSITE_URL = "https://github.com/heznpc/AirMCP";

/**
 * Server `instructions` sent in the MCP initialize response (ServerOptions.instructions).
 * This is the ONE channel that states AirMCP's identity directly into every connected
 * client's context — without it, a fresh session classifies AirMCP from its tool names
 * alone and mistakes a governed runtime for a personal-assistant/agent-framework clone.
 *
 * Wording tracks the canonical public positioning ("governed MCP runtime for the Apple
 * ecosystem … not another agent"). Keep it SHORT, STATIC, and COUNT-FREE: it is injected
 * every session, has no CI drift guard, and must never interpolate tool-returned or user
 * content. Every claim is code-grounded — no model/agent-loop in the request path, audit +
 * rate-limit wrap every call, HITL gates sensitive/destructive actions.
 */
export const SERVER_INSTRUCTIONS =
  "AirMCP is a governed MCP runtime for the Apple ecosystem — a connector and control " +
  "layer, not another agent. You are the agent; AirMCP is the governed layer your tool " +
  "calls pass through, and it runs no model, planner, or agent loop of its own. Rate limits " +
  "and a tamper-evident HMAC-chained audit log wrap every call; sensitive or destructive " +
  "actions also require per-call human approval, and an emergency stop can halt everything. " +
  "You start behind a small front door — call discover_tools or start_tool_session to widen " +
  "access as needed. Skills are deterministic YAML pipelines, not model reasoning; the " +
  "optional intelligence tools only delegate to on-device models and never drive AirMCP.";

// Stylized "A" with signal waves
const SERVER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
<rect width="128" height="128" rx="28" fill="#1a1a2e"/>
<path d="M64 28L36 100h12l6-16h20l6 16h12L64 28zm-6 44l10-28 10 28H58z" fill="#e0e0ff"/>
<path d="M88 36a32 32 0 010 56" stroke="#6c63ff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>
<path d="M96 28a44 44 0 010 72" stroke="#6c63ff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".4"/>
</svg>`;

export const SERVER_ICON: { src: string; mimeType: string; sizes: string[] } = {
  src: `data:image/svg+xml;base64,${Buffer.from(SERVER_ICON_SVG).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
};
