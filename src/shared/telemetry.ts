/**
 * Optional OpenTelemetry instrumentation for tool calls.
 *
 * Uses dynamic import — when `@opentelemetry/api` is not installed, all
 * instrumentation is silently skipped (zero overhead). When installed but
 * no TracerProvider is registered, the OTel API itself returns no-ops.
 *
 * Enable: `AIRMCP_TELEMETRY=true` or `config.json → features.telemetry: true`
 */

import { NPM_PACKAGE_NAME } from "./config.js";

type Tracer = {
  startActiveSpan: <T>(name: string, fn: (span: Span) => T) => T;
};

type Span = {
  setAttribute: (key: string, value: string | number | boolean) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  recordException: (error: unknown) => void;
  end: () => void;
};

let tracer: Tracer | null | undefined; // undefined = not yet loaded
let tracerLoading: Promise<Tracer | null> | undefined;

// Computed module name bypasses TS module resolution for this optional peer dep.
const OTEL_MODULE = "@opentelemetry/api";

async function loadTracer(): Promise<Tracer | null> {
  try {
    const api = await import(/* webpackIgnore: true */ OTEL_MODULE);
    return api.trace.getTracer(NPM_PACKAGE_NAME);
  } catch {
    return null;
  }
}

function getTracer(): Tracer | null | Promise<Tracer | null> {
  if (tracer !== undefined) return tracer; // sync fast path — no Promise allocation
  if (!tracerLoading) {
    tracerLoading = loadTracer().then((t) => {
      tracer = t;
      return t;
    });
  }
  return tracerLoading;
}

/**
 * Record a HITL approval decision as an OTel span.
 * Enterprise SIEM systems (Splunk, Cribl) correlate these with Compliance API records.
 */
export async function traceApproval(
  toolName: string,
  decision: "approved" | "denied" | "skipped",
  channel: "elicitation" | "socket",
  attrs?: { destructive?: boolean; managed?: boolean },
): Promise<void> {
  const t = await getTracer();
  if (!t) return;

  t.startActiveSpan(`tool.approval`, (span: Span) => {
    span.setAttribute("mcp.tool.name", toolName);
    span.setAttribute("mcp.approval.decision", decision);
    span.setAttribute("mcp.approval.channel", channel);
    if (attrs?.destructive !== undefined) span.setAttribute("mcp.approval.destructive", attrs.destructive);
    if (attrs?.managed !== undefined) span.setAttribute("mcp.approval.managed_client", attrs.managed);
    span.setStatus({ code: decision === "denied" ? 2 /* ERROR */ : 1 /* OK */ });
    span.end();
  });
}

/**
 * Wrap a tool call with an OTel span. If OTel is unavailable, runs `fn` directly.
 */
export async function traceToolCall<T>(toolName: string, argCount: number, fn: () => Promise<T>): Promise<T> {
  const t = await getTracer();
  if (!t) return fn();

  return t.startActiveSpan(`tool.${toolName}`, async (span: Span) => {
    span.setAttribute("mcp.tool.name", toolName);
    span.setAttribute("mcp.tool.arg_count", argCount);
    try {
      const result = await fn();
      span.setStatus({ code: 1 /* OK */ });
      return result;
    } catch (error) {
      span.setStatus({ code: 2 /* ERROR */, message: String(error) });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
