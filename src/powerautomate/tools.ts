import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { okUntrusted, errUpstream, toolErr } from "../shared/result.js";
import {
  triggerCloudFlow,
  CloudFlowError,
  CLOUDFLOW_HARD_TIMEOUT_MS,
  CLOUDFLOW_DEFAULT_MAX_RESPONSE_BYTES,
  CLOUDFLOW_HARD_MAX_RESPONSE_BYTES,
} from "./api.js";

/**
 * Power Automate module — opt-in outbound connector.
 *
 * Enable with AIRMCP_ENABLE_POWERAUTOMATE=true (absent from every profile,
 * including `full`, by default). Pairs with the webhooks module for the
 * round trip: a skill triggers a Cloud Flow with cloudflow_trigger, the flow
 * does Windows-side work, then POSTs back to the webhook listener, which emits
 * webhook_received for a follow-up skill.
 */
export function registerPowerAutomateTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "cloudflow_trigger",
    {
      title: "Trigger Power Automate Cloud Flow",
      description:
        "POST to a Power Automate Cloud Flow HTTP request URL. Works from any OS. " +
        "Supports SAS-signed URLs (sig query param) or OAuth Bearer auth. " +
        "Hard 120s timeout — the Cloud Flow Response action will not return after that.",
      inputSchema: {
        url: z.string().url().describe("Cloud Flow HTTP trigger URL (include the sig param if SAS)"),
        auth: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("sas") }),
            z.object({
              type: z.literal("oauth"),
              bearer: z.string().min(1).describe("Bearer token (no 'Bearer ' prefix)"),
            }),
          ])
          .describe("sas → the URL's sig param handles auth; oauth → sends Authorization: Bearer"),
        body: z.record(z.string(), z.unknown()).optional().describe("JSON body matching the flow's trigger schema"),
        timeoutMs: z
          .number()
          .int()
          .min(1)
          .max(CLOUDFLOW_HARD_TIMEOUT_MS)
          .default(CLOUDFLOW_HARD_TIMEOUT_MS)
          .describe("Request timeout in ms (max 120000 — Cloud Flow Response action cap)"),
        maxResponseBytes: z
          .number()
          .int()
          .min(1024)
          .max(CLOUDFLOW_HARD_MAX_RESPONSE_BYTES)
          .default(CLOUDFLOW_DEFAULT_MAX_RESPONSE_BYTES)
          .describe(
            "Max response body size to read (default 10 MiB, ceiling 100 MiB). " +
              "Guards against agent-loop OOM when a misconfigured flow streams a large body.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, auth, body, timeoutMs, maxResponseBytes }) => {
      try {
        const result = await triggerCloudFlow({ url, auth, body, timeoutMs, maxResponseBytes });
        const payload = {
          status: result.status,
          statusText: result.statusText,
          body: result.body,
          ...(result.truncated ? { truncated: true, bytesRead: result.totalBytes, cap: maxResponseBytes } : {}),
        };
        // A non-2xx from the flow is an upstream failure the agent should see
        // as an error; the (untrusted) response body still rides along in the
        // message so the caller can inspect what the flow returned.
        if (!result.ok) {
          return errUpstream(
            `Cloud Flow returned ${result.status} ${result.statusText}: ${JSON.stringify(result.body)}`,
          );
        }
        // The response is third-party content — mark it untrusted so the model
        // treats it as data, not instructions.
        return okUntrusted(payload);
      } catch (e) {
        if (e instanceof CloudFlowError) {
          return e.aborted ? toolErr("upstream_timeout", e.message) : errUpstream(e.message);
        }
        return errUpstream(`Failed to trigger Cloud Flow: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
