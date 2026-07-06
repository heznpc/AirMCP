// Inbound webhook listener — a singleton, opt-in loopback HTTP server that
// receives external callbacks (Power Automate Cloud Flow, CI, home
// automation, anything that can POST) and turns each verified request into a
// `webhook_received` event on the AirMCP event bus. Skills bind to that event
// the same way they bind to calendar_changed / pasteboard_changed etc.
//
// Ported from newtria's webhook_listener tool (Apache-2.0, same author),
// relicensed MIT. newtria dispatched straight to a named macOS shortcut and
// blocked the tool call for the listener's whole lifetime; here the listener
// is a lifecycle component (like the Node-side pollers) that emits an event
// and returns 202 immediately, decoupling receipt from whatever skill handles
// it. AirMCP's 9 existing event sources are all *local* observation — this is
// the first source that lets the outside world push an event to a skill.
//
// Transport-independent by design: it owns its own http.createServer bound to
// loopback, so it works under the default stdio transport (the common case for
// Claude Desktop / `npx airmcp`), not only under the optional `--http` server.
//
// Safety posture (mirrors newtria's defaults, tightened):
//   - binds 127.0.0.1 only unless bindHost is set explicitly, and any
//     non-loopback bind REQUIRES an HMAC secret (newtria allowed 0.0.0.0
//     without one — that hole is closed here);
//   - HMAC-SHA256 verification (constant-time) via x-airmcp-signature;
//   - body size cap with early cut-off (413) so a stream can't pin memory;
//   - the module itself is opt-in (OPT_IN_MODULE_NAMES) so this capability is
//     absent from every profile — including `full` — unless the operator sets
//     AIRMCP_ENABLE_WEBHOOKS=true.

import { createServer, type Server as HttpServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eventBus } from "../shared/event-bus.js";
import { log, errToCtx } from "../shared/logger.js";

export interface WebhookListenerOptions {
  endpointPath: string;
  port: number;
  bindHost: string;
  expectedSecret?: string;
  maxBodyBytes: number;
}

export interface WebhookListenerStatus {
  running: boolean;
  endpoint?: string;
  /** The port the OS actually bound (differs from the requested port when 0 is passed). */
  boundPort?: number;
  hmac?: boolean;
  hits: number;
  startedAt?: string;
}

// Header the caller must send when an HMAC secret is configured. Hex-encoded
// HMAC-SHA256 of the raw request body under the shared secret.
const SIGNATURE_HEADER = "x-airmcp-signature";

// Header names never forwarded into the event payload — they carry the very
// secrets we're verifying, and the payload flows into skill execution and can
// end up in an LLM's context. Everything else passes through so a skill can
// route on custom headers.
const REDACTED_HEADERS = new Set([SIGNATURE_HEADER, "authorization", "cookie", "proxy-authorization"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

let server: HttpServer | null = null;
let active: WebhookListenerOptions | null = null;
let boundPort: number | null = null;
let hits = 0;
let startedAt: string | null = null;
// Set synchronously at the top of startWebhookListener so a second concurrent
// start (possible across sessions on the app-owned runtime, before the async
// `listen` callback assigns `server`) is rejected instead of racing — otherwise
// the loser's EADDRINUSE handler could clear the winner's registration and
// orphan a live socket.
let starting = false;
// Set by stopWebhookListener when a stop arrives during the `starting` window
// (before `listen` has assigned `server`). The listen callback honors it by
// closing the freshly-bound socket instead of registering it — otherwise a
// stop() would no-op and the socket would come up live and untracked.
let stopRequested = false;

/** True when bindHost would expose the listener beyond loopback. */
export function isNonLoopback(bindHost: string): boolean {
  return !LOOPBACK_HOSTS.has(bindHost);
}

function filterHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (REDACTED_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function verifyHmac(secret: string, raw: Buffer, sigHeader: string | string[] | undefined): boolean {
  const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  // Buffer.from(_, "hex") does not throw on malformed input — it stops at the
  // first invalid nibble and returns a short/empty buffer. The length check
  // below is therefore the real gate: a valid 32-byte HMAC needs exactly 64 hex
  // chars, so any odd/non-hex/empty signature decodes short and is rejected.
  // Keep the length comparison if this ever gets refactored.
  const provided = Buffer.from(sig, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * Start the inbound webhook listener. Idempotent per process: only one
 * listener runs at a time. Rejects (throws) on a policy violation or a bind
 * error so the caller can surface it as a tool error.
 */
export function startWebhookListener(opts: WebhookListenerOptions): Promise<WebhookListenerStatus> {
  return new Promise((resolve, reject) => {
    if (server || starting) {
      reject(new Error("A webhook listener is already running. Stop it before starting another."));
      return;
    }
    if (isNonLoopback(opts.bindHost) && !opts.expectedSecret) {
      reject(
        new Error(
          `Refusing to bind ${opts.bindHost} without an HMAC secret. Non-loopback exposure requires expectedSecret (min 32 chars). Bind 127.0.0.1 for local-only use, or supply a secret.`,
        ),
      );
      return;
    }

    starting = true;
    stopRequested = false;
    hits = 0;
    const httpServer = createServer((req, res) => {
      if (req.url !== opts.endpointPath || req.method !== "POST") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      // Track the running total during 'data' and cut off early on overflow so
      // an attacker's stream isn't buffered whole into memory.
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let oversized = false;
      req.on("data", (c: Buffer) => {
        if (oversized) return;
        totalBytes += c.byteLength;
        if (totalBytes > opts.maxBodyBytes) {
          oversized = true;
          res.statusCode = 413;
          res.end("payload too large");
          req.destroy();
          return;
        }
        chunks.push(c);
      });

      req.on("end", () => {
        if (oversized) return;
        const raw = Buffer.concat(chunks);

        if (opts.expectedSecret && !verifyHmac(opts.expectedSecret, raw, req.headers[SIGNATURE_HEADER])) {
          res.statusCode = 401;
          res.end("invalid signature");
          return;
        }

        const bodyText = raw.toString("utf-8");
        hits += 1;

        // Emit and acknowledge. The listener does NOT stamp an actor — the
        // trigger engine stamps `daemon-skill:<name>` when it dispatches the
        // bound skill (src/skills/triggers.ts). 202 Accepted reflects the
        // decoupling: we verified and queued the event, but the skill runs
        // asynchronously so its outcome isn't knowable in this response.
        eventBus.emitNodeEvent("webhook_received", {
          path: opts.endpointPath,
          headers: filterHeaders(req.headers),
          body: bodyText,
          bytes: raw.length,
          remoteAddress: req.socket.remoteAddress ?? null,
          receivedAt: new Date().toISOString(),
        });

        res.statusCode = 202;
        res.end("accepted");
      });

      req.on("error", () => {
        if (!res.headersSent) {
          res.statusCode = 400;
          res.end("bad request");
        }
      });
    });

    httpServer.on("error", (err) => {
      // Only tear down registration if THIS attempt owns it. A late error on a
      // server that already handed off (or was replaced) must not clear a live
      // listener's state.
      if (server === httpServer || server === null) {
        server = null;
        active = null;
      }
      starting = false;
      reject(err);
    });

    httpServer.listen(opts.port, opts.bindHost, () => {
      // A stop() arrived while we were still binding — honor it by closing the
      // socket now instead of registering it, so we never leave a live listener
      // that stop() already reported as not running.
      if (stopRequested) {
        starting = false;
        stopRequested = false;
        httpServer.close();
        resolve({ running: false, hits });
        return;
      }
      server = httpServer;
      active = opts;
      starting = false;
      const addr = httpServer.address();
      boundPort = addr && typeof addr === "object" ? addr.port : opts.port;
      startedAt = new Date().toISOString();
      log.info("webhook listener started", {
        endpoint: `${opts.bindHost}:${opts.port}${opts.endpointPath}`,
        hmac: Boolean(opts.expectedSecret),
      });
      resolve(getWebhookListenerStatus());
    });
  });
}

/** Stop the listener if running. Idempotent. */
export function stopWebhookListener(): Promise<WebhookListenerStatus> {
  return new Promise((resolve) => {
    if (!server) {
      // A start is mid-bind (server not yet assigned). Flag it so the pending
      // listen callback closes the socket instead of coming up live; without
      // this, stop() would report "not running" and then the listener would
      // orphan itself onto the port.
      if (starting) stopRequested = true;
      resolve(getWebhookListenerStatus());
      return;
    }
    const s = server;
    server = null;
    const finalStatus: WebhookListenerStatus = { running: false, hits };
    active = null;
    startedAt = null;
    s.close((err) => {
      if (err) log.warn("webhook listener close error", { err: errToCtx(err) });
      resolve(finalStatus);
    });
  });
}

export function getWebhookListenerStatus(): WebhookListenerStatus {
  if (!server || !active) return { running: false, hits };
  return {
    running: true,
    endpoint: `${active.bindHost}:${boundPort ?? active.port}${active.endpointPath}`,
    boundPort: boundPort ?? active.port,
    hmac: Boolean(active.expectedSecret),
    hits,
    startedAt: startedAt ?? undefined,
  };
}

/** Test-only: force the singleton back to a clean state. */
export function _resetWebhookListenerForTests(): void {
  if (server) server.close();
  server = null;
  active = null;
  boundPort = null;
  starting = false;
  hits = 0;
  startedAt = null;
}
