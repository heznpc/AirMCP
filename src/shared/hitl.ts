import { createConnection, Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { HitlConfig } from "./config.js";

interface HitlRequest {
  id: string;
  type: "hitl_request";
  tool: string;
  args: Record<string, unknown>;
  module?: string;
  destructive: boolean;
  openWorld: boolean;
}

interface HitlResponse {
  id: string;
  type: "hitl_response";
  approved: boolean;
}

export class HitlClient {
  private socket: Socket | null = null;
  private pending = new Map<string, { resolve: (approved: boolean) => void }>();
  private buffer = "";
  private connecting = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private config: HitlConfig) {}

  async requestApproval(
    tool: string,
    args: Record<string, unknown>,
    destructive: boolean,
    openWorld: boolean,
  ): Promise<boolean> {
    try {
      await this.ensureConnected();
    } catch {
      console.error(`[hitl] socket unreachable at ${this.config.socketPath} — denying "${tool}"`);
      return false;
    }

    const id = randomUUID();
    const request: HitlRequest = {
      id,
      type: "hitl_request",
      tool,
      args,
      destructive,
      openWorld,
    };

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        console.error(`[hitl] timeout waiting for approval of "${tool}" — denying`);
        resolve(false);
      }, this.config.timeout * 1000);

      this.pending.set(id, {
        resolve: (approved: boolean) => {
          clearTimeout(timer);
          resolve(approved);
        },
      });

      try {
        this.socket!.write(JSON.stringify(request) + "\n");
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        console.error(`[hitl] failed to send request for "${tool}" — denying`);
        resolve(false);
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
      console.error("[hitl] buffer exceeded 1MB — resetting and denying all pending");
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
            entry.resolve(msg.approved);
          }
        }
      } catch {
        console.error("[hitl] failed to parse response:", trimmed);
      }
    }
  }

  private denyAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      console.error(`[hitl] ${reason} — denying pending request ${id}`);
      entry.resolve(false);
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
