import { createConnection, Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { HitlConfig } from "./config.js";
import { log } from "./logger.js";
import { getCorrelationId } from "./request-context.js";

interface HitlRequest {
  id: string;
  type: "hitl_request";
  tool: string;
  args: Record<string, unknown>;
  module?: string;
  destructive: boolean;
  sensitive: boolean;
  openWorld: boolean;
  correlationId?: string;
}

interface HitlResponse {
  id: string;
  type: "hitl_response";
  approved: unknown;
  reason?: unknown;
}

export type HitlApprovalDecision = "approved" | "denied" | "timed_out" | "unavailable";

export class HitlClient {
  private socket: Socket | null = null;
  private pending = new Map<string, { resolve: (decision: HitlApprovalDecision) => void }>();
  private buffer = "";
  private connecting = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private config: HitlConfig) {}

  /**
   * Probe whether anything is listening on the approval socket without
   * sending a request. The HITL guard uses this to pick a channel for
   * managed clients: socket when the menubar app is up, MCP elicitation
   * otherwise (RFC 0008 §3.4 / Phase 1.5). A successful probe leaves the
   * connection open for the subsequent requestApproval call.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return true;
    } catch {
      return false;
    }
  }

  async requestApproval(
    tool: string,
    args: Record<string, unknown>,
    destructive: boolean,
    openWorld: boolean,
    sensitive = false,
  ): Promise<boolean> {
    return (await this.requestApprovalDecision(tool, args, destructive, openWorld, sensitive)) === "approved";
  }

  /** Structured decision API for governed callers that must distinguish an
   * explicit human denial from a timeout or a failed approval channel. The
   * boolean requestApproval() adapter remains the compatibility surface. */
  async requestApprovalDecision(
    tool: string,
    args: Record<string, unknown>,
    destructive: boolean,
    openWorld: boolean,
    sensitive = false,
  ): Promise<HitlApprovalDecision> {
    try {
      await this.ensureConnected();
    } catch {
      log.warn("hitl: socket unreachable — approval unavailable", { socket: this.config.socketPath, tool });
      return "unavailable";
    }

    const id = randomUUID();
    const correlationId = getCorrelationId();
    const request: HitlRequest = {
      id,
      type: "hitl_request",
      tool,
      args,
      destructive,
      sensitive,
      openWorld,
      ...(correlationId ? { correlationId } : {}),
    };

    return new Promise<HitlApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        log.warn("hitl: timeout waiting for approval", { tool });
        resolve("timed_out");
      }, this.config.timeout * 1000);

      this.pending.set(id, {
        resolve: (decision: HitlApprovalDecision) => {
          clearTimeout(timer);
          resolve(decision);
        },
      });

      try {
        this.socket!.write(JSON.stringify(request) + "\n");
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        log.warn("hitl: failed to send request — approval unavailable", { tool });
        resolve("unavailable");
      }
    });
  }

  private ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.connect();
    return this.connectPromise;
  }

  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connecting = true;
      const socket = createConnection({ path: this.config.socketPath }, () => {
        this.socket = socket;
        this.connecting = false;
        this.connectPromise = null;
        this.buffer = "";
        resolve();
      });

      socket.setEncoding("utf-8");

      socket.on("data", (chunk: string) => {
        this.onData(chunk);
      });

      socket.on("error", (error) => {
        socket.destroy();
        if (this.connecting) {
          this.connecting = false;
          this.connectPromise = null;
          reject(error);
        }
        this.denyAllPending("socket error");
      });

      socket.on("close", () => {
        this.socket = null;
        this.connectPromise = null;
        this.denyAllPending("socket closed");
      });
    });
  }

  private static readonly MAX_BUFFER_SIZE = 1_048_576; // 1MB

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Prevent unbounded buffer growth (DoS protection)
    if (this.buffer.length > HitlClient.MAX_BUFFER_SIZE) {
      log.warn("hitl: buffer exceeded 1MB — resetting and denying all pending");
      this.buffer = "";
      this.denyAllPending("buffer overflow");
      return;
    }
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as HitlResponse;
        if (msg.type === "hitl_response" && msg.id) {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            entry.resolve(HitlClient.decisionFromResponse(msg));
          }
        }
      } catch {
        log.warn("hitl: failed to parse response", { preview: trimmed.slice(0, 200) });
      }
    }
  }

  private static decisionFromResponse(response: HitlResponse): HitlApprovalDecision {
    if (response.approved === true) {
      // Legacy peers omit reason. A contradictory reason is malformed and
      // therefore unavailable rather than authority to mutate.
      return response.reason === undefined || response.reason === "approved" ? "approved" : "unavailable";
    }
    if (response.approved !== false) return "unavailable";
    // Legacy false-without-reason was an explicit denial, so keep that wire
    // compatibility while recognizing the richer protocol from current apps.
    if (response.reason === undefined || response.reason === "denied") return "denied";
    if (response.reason === "timed_out") return "timed_out";
    if (response.reason === "unavailable") return "unavailable";
    return "unavailable";
  }

  private denyAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      log.warn("hitl: approval became unavailable for pending request", { reason, id });
      entry.resolve("unavailable");
    }
    this.pending.clear();
  }

  dispose(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.denyAllPending("dispose");
  }
}
