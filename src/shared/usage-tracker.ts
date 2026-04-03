import { readFile, writeFile, mkdir } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "./constants.js";

interface UsageProfile {
  version: number;
  /** tool → total call count */
  frequency: Record<string, number>;
  /** "toolA → toolB" → count (sequential call pattern) */
  sequences: Record<string, number>;
  /** tool → hour-of-day histogram (0-23) */
  hourly: Record<string, number[]>;
  /** Last flush timestamp */
  updatedAt: string;
}

const FLUSH_INTERVAL = 60_000; // flush to disk every 60s
const MAX_SEQUENCE_ENTRIES = 500;

class UsageTracker {
  private lastTool: string | null = null;
  private profile: UsageProfile | null = null;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded: Promise<void> | null = null;

  record(toolName: string): void {
    const now = Date.now();

    if (!this.profile) {
      this.loadSync();
    }

    const p = this.profile!;

    // Frequency
    p.frequency[toolName] = (p.frequency[toolName] || 0) + 1;

    // Sequence (previous → current)
    if (this.lastTool && this.lastTool !== toolName) {
      const key = `${this.lastTool} → ${toolName}`;
      p.sequences[key] = (p.sequences[key] || 0) + 1;

      // Batch prune: only sort when 20% over limit, trim back to limit
      const seqCount = Object.keys(p.sequences).length;
      if (seqCount > MAX_SEQUENCE_ENTRIES * 1.2) {
        const sorted = Object.keys(p.sequences).sort((a, b) => p.sequences[a]! - p.sequences[b]!);
        for (let i = 0; i < sorted.length - MAX_SEQUENCE_ENTRIES; i++) {
          delete p.sequences[sorted[i]!];
        }
      }
    }
    this.lastTool = toolName;

    // Hourly pattern
    const hour = new Date(now).getHours();
    if (!p.hourly[toolName]) {
      p.hourly[toolName] = new Array(24).fill(0);
    }
    p.hourly[toolName]![hour]!++;

    this.dirty = true;
    this.ensureFlushTimer();
  }

  /** Get top tool sequences for a given tool (what usually comes next). */
  getNextTools(toolName: string, topK = 5): Array<{ tool: string; count: number }> {
    if (!this.profile) return [];
    const prefix = `${toolName} → `;
    const results: Array<{ tool: string; count: number }> = [];
    for (const [key, count] of Object.entries(this.profile.sequences)) {
      if (key.startsWith(prefix)) {
        results.push({ tool: key.slice(prefix.length), count });
      }
    }
    results.sort((a, b) => b.count - a.count);
    return results.slice(0, topK);
  }

  /** Get usage stats summary. */
  getStats(): {
    totalCalls: number;
    topTools: Array<{ tool: string; count: number }>;
    topSequences: Array<{ sequence: string; count: number }>;
  } {
    if (!this.profile) return { totalCalls: 0, topTools: [], topSequences: [] };
    const p = this.profile;

    const totalCalls = Object.values(p.frequency).reduce((a, b) => a + b, 0);

    const topTools = Object.entries(p.frequency)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topSequences = Object.entries(p.sequences)
      .map(([sequence, count]) => ({ sequence, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { totalCalls, topTools, topSequences };
  }

  /** Flush to disk immediately (async). Waits for disk load to complete first. */
  async flush(): Promise<void> {
    if (this.loaded) await this.loaded;
    if (!this.dirty || !this.profile) return;
    this.profile.updatedAt = new Date().toISOString();
    try {
      await mkdir(dirname(PATHS.USAGE_PROFILE), { recursive: true });
      await writeFile(PATHS.USAGE_PROFILE, JSON.stringify(this.profile, null, 2), "utf-8");
      this.dirty = false;
    } catch {
      // Non-critical — silently ignore write failures
    }
  }

  /** Synchronous flush for process exit handler. Skips if disk load still in-flight to avoid partial writes. */
  flushSync(): void {
    if (this.loaded || !this.dirty || !this.profile) return;
    this.profile.updatedAt = new Date().toISOString();
    try {
      mkdirSync(dirname(PATHS.USAGE_PROFILE), { recursive: true });
      writeFileSync(PATHS.USAGE_PROFILE, JSON.stringify(this.profile, null, 2), "utf-8");
      this.dirty = false;
    } catch {
      // Non-critical
    }
  }

  /** Stop the flush timer (for clean shutdown). */
  stop(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private loadSync(): void {
    this.profile = { version: 1, frequency: {}, sequences: {}, hourly: {}, updatedAt: "" };
    this.loaded = this.loadFromDisk()
      .catch(() => {})
      .then(() => {
        this.loaded = null;
      });
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const data = await readFile(PATHS.USAGE_PROFILE, "utf-8");
      const loaded = JSON.parse(data) as UsageProfile;
      if (loaded.version === 1 && this.profile) {
        // Merge disk data with in-memory (in-memory wins for current session)
        for (const [k, v] of Object.entries(loaded.frequency)) {
          this.profile.frequency[k] = (this.profile.frequency[k] || 0) + v;
        }
        for (const [k, v] of Object.entries(loaded.sequences)) {
          this.profile.sequences[k] = (this.profile.sequences[k] || 0) + v;
        }
        for (const [k, v] of Object.entries(loaded.hourly)) {
          if (!this.profile.hourly[k]) {
            this.profile.hourly[k] = [...v];
          } else {
            for (let i = 0; i < 24; i++) {
              this.profile.hourly[k]![i]! += v[i] || 0;
            }
          }
        }
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush().catch(() => {});
      this.flushTimer = null;
    }, FLUSH_INTERVAL);
    // Don't prevent process exit
    if (this.flushTimer.unref) this.flushTimer.unref();
  }
}

export const usageTracker = new UsageTracker();
