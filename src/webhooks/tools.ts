import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, errInvalidInput, errUpstream } from "../shared/result.js";
import { startWebhookListener, stopWebhookListener, getWebhookListenerStatus, isNonLoopback } from "./listener.js";

/**
 * Webhooks module — opt-in inbound HTTP event source.
 *
 * Enable with AIRMCP_ENABLE_WEBHOOKS=true (it is absent from every profile,
 * including `full`, by default). Once started, external callers POST to the
 * loopback endpoint and each verified request becomes a `webhook_received`
 * event; bind a skill to that event to act on it.
 */
export function registerWebhooksTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "webhook_listen_start",
    {
      title: "Start inbound webhook listener",
      description:
        "Start a loopback HTTP listener that turns each verified POST into a `webhook_received` event on the AirMCP event bus. " +
        "Bind a skill (trigger.event: webhook_received) to act on it. Optional HMAC-SHA256 verification via the x-airmcp-signature header. " +
        "Binds 127.0.0.1 by default; any non-loopback bindHost requires expectedSecret. Only one listener runs at a time.",
      inputSchema: {
        endpointPath: z
          .string()
          .regex(/^\/[a-zA-Z0-9_-]+$/, "Must be a single path segment like /trigger")
          .default("/webhook")
          .describe("URL path the webhook listens on, e.g. /trigger"),
        port: z.number().int().min(1).max(65535).default(8787).describe("Port to listen on"),
        bindHost: z
          .string()
          .default("127.0.0.1")
          .describe("Interface to bind. '0.0.0.0' exposes on LAN and then requires expectedSecret."),
        expectedSecret: z
          .string()
          .min(32)
          .optional()
          .describe(
            "HMAC-SHA256 secret (min 32 chars, ≥256 bits if random). When set, the x-airmcp-signature header is required and verified.",
          ),
        maxBodyBytes: z
          .number()
          .int()
          .min(1024)
          .max(10 * 1024 * 1024)
          .default(1024 * 1024)
          .describe("Reject POSTs whose body exceeds this size (default 1 MiB, returns 413)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ endpointPath, port, bindHost, expectedSecret, maxBodyBytes }) => {
      if (isNonLoopback(bindHost) && !expectedSecret) {
        return errInvalidInput(
          `Binding ${bindHost} exposes the listener beyond loopback and requires expectedSecret (min 32 chars). ` +
            `Bind 127.0.0.1 for local-only use, or supply a secret.`,
        );
      }
      try {
        const status = await startWebhookListener({ endpointPath, port, bindHost, expectedSecret, maxBodyBytes });
        return ok({
          ...status,
          note: "Listener is live. External POSTs now emit webhook_received. Bind a skill with trigger.event: webhook_received to handle them.",
        });
      } catch (e) {
        return errUpstream(`Failed to start webhook listener: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "webhook_listen_stop",
    {
      title: "Stop inbound webhook listener",
      description:
        "Stop the running webhook listener and close its port. Idempotent — safe to call when none is running.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const status = await stopWebhookListener();
      return ok(status);
    },
  );

  server.registerTool(
    "webhook_listen_status",
    {
      title: "Webhook listener status",
      description: "Report whether the inbound webhook listener is running, its endpoint, HMAC state, and hit count.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ok(getWebhookListenerStatus()),
  );
}
