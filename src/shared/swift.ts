import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { TIMEOUT, BUFFER } from "./constants.js";
import { eventBus } from "./event-bus.js";
import { log } from "./logger.js";

// Package root — works in repo checkout, npm cache, and git worktrees.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_BINARY_PATH = resolve(PKG_ROOT, "swift", ".build", "release", "AirMcpBridge");

/** Resolve the bridge embedded by AirMCP.app before falling back to the
 * package-local development build. The signed app runtime launches from its
 * bundled `server/` tree, so deriving the bridge from PKG_ROOT cannot reach
 * `Contents/Resources/airmcp/bin/AirMcpBridge`. */
export function resolveSwiftBridgePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AIRMCP_BRIDGE_PATH?.trim();
  return configured ? resolve(configured) : DEFAULT_BINARY_PATH;
}

const BINARY_PATH = resolveSwiftBridgePath();

// ── Bridge availability check ────────────────────────────────────────

let bridgeChecked = false;
let bridgeError: string | null = null;

export async function checkSwiftBridge(): Promise<string | null> {
  if (bridgeChecked) return bridgeError;
  try {
    await access(BINARY_PATH);
    bridgeError = null;
  } catch {
    bridgeError =
      "Apple Intelligence requires macOS 26+ with Apple Silicon. Swift bridge not found. Run 'npm run swift-build' to compile.";
  }
  bridgeChecked = true;
  return bridgeError;
}

// ── Command discovery ────────────────────────────────────────────────

let swiftCommands: Set<string> | null = null;
let commandsFetching: Promise<void> | null = null;

/**
 * Load the set of commands supported by the Swift bridge.
 * Caches the result so subsequent calls are instant.
 */
async function loadSwiftCommands(): Promise<void> {
  if (swiftCommands !== null) return;
  if (commandsFetching) return commandsFetching;

  commandsFetching = (async () => {
    try {
      const commands = await runSwift<string[]>("list-commands", "{}");
      swiftCommands = new Set(commands);
    } catch {
      swiftCommands = new Set(); // Bridge unavailable — empty set
    } finally {
      commandsFetching = null;
    }
  })();

  return commandsFetching;
}

/**
 * Check whether the Swift bridge supports a specific command.
 * Returns false if the bridge is not available or the command is unknown.
 */
export async function hasSwiftCommand(name: string): Promise<boolean> {
  const missing = await checkSwiftBridge();
  if (missing) return false;
  await loadSwiftCommands();
  return swiftCommands?.has(name) ?? false;
}

// ── Safe JSON parsing (prototype pollution prevention) ───────────────

interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: string;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse a Swift bridge JSON response safely.
 *
 * Uses a reviver to reject payloads with __proto__, constructor, or prototype
 * keys at any nesting depth, preventing prototype pollution attacks.
 *
 * Threat model: the Swift helper speaks JSON over stdout, but the data it
 * encodes ultimately comes from untrusted user content inside macOS apps
 * (note titles, reminder names, calendar event descriptions, contact card
 * fields, etc.). A malicious invitee or collaborator could embed
 * `{"__proto__": …}` in a field that Swift dumps verbatim — without this
 * guard a plain `JSON.parse` would mutate `Object.prototype` for the entire
 * Node process and taint every subsequent tool response. The reviver is
 * cheap (one Set lookup per key) and runs on both persistent-mode and
 * single-shot responses, so every bridge path is covered.
 */
function safeParseBridgeResponse(raw: string): BridgeResponse | null {
  // Fast path: if the raw bytes contain any dangerous key literal, reject
  // outright. This is defence-in-depth on top of the reviver — even though
  // `return undefined` below drops the key, rejecting the whole payload is
  // safer than silently stripping fields we may later need for diagnostics.
  if (containsDangerousKey(raw)) return null;
  let poisoned = false;
  const parsed: unknown = JSON.parse(raw, (key, value) => {
    if (DANGEROUS_KEYS.has(key)) {
      poisoned = true;
      return undefined; // Drop the key so the parent object is never mutated.
    }
    return value;
  });
  if (poisoned) return null;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.id !== "string") return null;
  return {
    id: obj.id,
    result: obj.result,
    error: typeof obj.error === "string" ? obj.error : undefined,
  };
}

/** Cheap string pre-check for the three dangerous keys. Catches the payload
 *  before it ever enters `JSON.parse`, which closes the theoretical window
 *  between "reviver runs" and "value is assigned" in engines where the
 *  order is not strictly defined. `DANGEROUS_KEYS` is a hot-set of 3 items;
 *  we scan for each quoted form (only object keys must be quoted). */
function containsDangerousKey(raw: string): boolean {
  return raw.includes('"__proto__"') || raw.includes('"constructor"') || raw.includes('"prototype"');
}

// ── Persistent process management ────────────────────────────────────

interface PendingRequest {
  readonly request: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  process: ChildProcess | null;
}

class SwiftBridgeClosedError extends Error {
  constructor() {
    super("Swift bridge closed");
    this.name = "SwiftBridgeClosedError";
  }
}

interface BridgeLane {
  readonly name: "default" | "embedding" | "observer";
  child: ChildProcess | null;
  launchingChild: ChildProcess | null;
  buffer: string;
  readonly pending: Map<string, PendingRequest>;
  activeRequestId: string | null;
  launching: Promise<void> | null;
  launchReject: ((error: Error) => void) | null;
  launchTimer: ReturnType<typeof setTimeout> | null;
  launchFailed: boolean;
  launchFailedAt: number;
  launchRetryCount: number;
}

function createBridgeLane(name: BridgeLane["name"]): BridgeLane {
  return {
    name,
    child: null,
    launchingChild: null,
    buffer: "",
    pending: new Map(),
    activeRequestId: null,
    launching: null,
    launchReject: null,
    launchTimer: null,
    launchFailed: false,
    launchFailedAt: 0,
    launchRetryCount: 0,
  };
}

// NaturalLanguage contextual embeddings can take minutes to load and index a
// large tool catalog. Native observers must also outlive an unrelated command
// timeout: timeout recovery terminates the affected serial bridge process, and
// restarting the default lane would not re-run start-observer. Isolate both
// workloads so neither can block or tear down the other bridge responsibilities.
const EMBEDDING_COMMANDS = new Set(["embed-text", "embed-batch"]);
const OBSERVER_COMMANDS = new Set(["start-observer", "stop-observer"]);
const defaultLane = createBridgeLane("default");
const embeddingLane = createBridgeLane("embedding");
const observerLane = createBridgeLane("observer");
const bridgeLanes = [defaultLane, embeddingLane, observerLane] as const;

function laneForCommand(command: string): BridgeLane {
  if (EMBEDDING_COMMANDS.has(command)) return embeddingLane;
  if (OBSERVER_COMMANDS.has(command)) return observerLane;
  return defaultLane;
}

const LAUNCH_COOLDOWN_MS = 30_000;
const LAUNCH_MAX_RETRIES = 3;

function ensureProcess(lane: BridgeLane): Promise<void> {
  if (lane.child && !lane.child.killed && lane.child.exitCode === null) return Promise.resolve();
  if (lane.launching) return lane.launching;

  // `exitCode`/`killed` can change before Node emits `close`. Detach that
  // generation now so its late lifecycle events and buffered stdout cannot
  // share lane state with the replacement launch.
  if (lane.child) {
    lane.child = null;
    rejectAll(lane, "Swift bridge process is no longer running");
  }

  lane.launching = new Promise<void>((resolve, reject) => {
    lane.launchFailed = false;
    lane.launchReject = reject;
    const proc = spawn(BINARY_PATH, ["--persistent"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    lane.launchingChild = proc;

    let ready = false;

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => {
      const ownsProcess = lane.child === proc || lane.launchingChild === proc;
      if (!ownsProcess) return;
      lane.buffer += chunk;
      // Kill immediately if buffer grows too large (prevents OOM)
      if (lane.buffer.length > BUFFER.SWIFT) {
        lane.buffer = "";
        rejectAll(lane, `Swift bridge persistent buffer exceeded ${BUFFER.SWIFT} bytes`);
        proc.kill("SIGKILL");
        return;
      }
      const lines = lane.buffer.split("\n");
      lane.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Per-line size guard — reject abnormally large single responses
        if (trimmed.length > BUFFER.SWIFT_LINE_MAX) {
          log.warn("swift bridge: dropping oversized response line", {
            limitBytes: BUFFER.SWIFT_LINE_MAX,
            lineBytes: trimmed.length,
          });
          continue;
        }
        try {
          const msg = safeParseBridgeResponse(trimmed);
          if (!msg) {
            log.warn("swift bridge: invalid response", { preview: trimmed.slice(0, 200) });
            continue;
          }

          // Handle readiness signal
          if (!ready && msg.id === "__ready__" && lane.launchingChild === proc) {
            ready = true;
            clearOwnedLaunchState(lane, proc, readyTimer);
            lane.child = proc;
            resolve();
            continue;
          }

          // Native events from the Swift observer share the same stdout
          // stream as RPC responses, tagged with the reserved id
          // "__event__". They carry no pending request — route the raw
          // line (not the BridgeResponse projection, which strips
          // event/data/timestamp) to the event bus so triggers fire.
          if (msg.id === "__event__") {
            eventBus.processLine(trimmed);
            continue;
          }

          const entry = lane.pending.get(msg.id);
          if (!entry) continue;
          // The native loop is serial and only the active request has been
          // written to stdin. Never let a stale/unsolicited response resolve a
          // request that is still queued for this lane.
          if (lane.activeRequestId !== msg.id || entry.process !== proc) continue;
          lane.pending.delete(msg.id);
          lane.activeRequestId = null;
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = null;
          entry.process = null;
          if (msg.error) {
            entry.reject(new Error(msg.error));
          } else {
            entry.resolve(msg.result);
          }
          dispatchNext(lane);
        } catch {
          log.warn("swift bridge: invalid response (parse threw)", { preview: trimmed.slice(0, 200) });
        }
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      // Swift bridge writes stderr only for warnings/errors under normal
      // operation, so we keep this at info — losing it would hide bridge
      // failures from the menubar log viewer. Volume is not a concern in
      // practice.
      log.info("swift bridge stderr", { line: chunk.toString().trim() });
    });

    proc.on("error", (err) => {
      const ownsActiveProcess = lane.child === proc;
      const ownsLaunch = lane.launchingChild === proc;
      if (!ownsActiveProcess && !ownsLaunch) return;
      rejectAll(lane, `Swift bridge error: ${err.message}`);
      if (ownsActiveProcess) lane.child = null;
      if (!ready && ownsLaunch) {
        clearOwnedLaunchState(lane, proc, readyTimer);
        lane.launchFailed = true;
        lane.launchFailedAt = Date.now();
        reject(err);
      }
    });

    proc.on("close", (code) => {
      const ownsActiveProcess = lane.child === proc;
      const ownsLaunch = lane.launchingChild === proc;
      if (!ownsActiveProcess && !ownsLaunch) return;
      rejectAll(lane, `Swift bridge exited with code ${code}`);
      if (ownsActiveProcess) lane.child = null;
      if (!ready && ownsLaunch) {
        clearOwnedLaunchState(lane, proc, readyTimer);
        lane.launchFailed = true;
        lane.launchFailedAt = Date.now();
        reject(new Error(`Swift bridge exited during startup with code ${code}`));
      }
    });

    // Timeout for initial readiness
    const readyTimer = setTimeout(() => {
      if (!ready && lane.launchingChild === proc) {
        proc.kill("SIGTERM");
        clearOwnedLaunchState(lane, proc, readyTimer);
        lane.launchFailed = true;
        lane.launchFailedAt = Date.now();
        reject(new Error("Swift bridge did not become ready within 10s"));
      }
    }, 10_000);
    lane.launchTimer = readyTimer;
  });

  return lane.launching;
}

/** Clear launch bookkeeping only when it still belongs to `proc`. */
function clearOwnedLaunchState(
  lane: BridgeLane,
  proc: ChildProcess,
  readyTimer: ReturnType<typeof setTimeout>,
): boolean {
  if (lane.launchingChild !== proc) return false;
  lane.launchingChild = null;
  lane.launching = null;
  lane.launchReject = null;
  if (lane.launchTimer === readyTimer) {
    clearTimeout(readyTimer);
    lane.launchTimer = null;
  }
  return true;
}

function rejectAll(lane: BridgeLane, message: string): void {
  for (const [, entry] of lane.pending) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  lane.pending.clear();
  lane.activeRequestId = null;
  lane.buffer = "";
}

/**
 * The Swift persistent loop awaits each command before reading the next line.
 * Mirror that ordering here: only the active request is written to stdin and
 * only its execution time counts toward TIMEOUT.SWIFT. This also makes an
 * active timeout safe to recover by terminating exactly that process.
 */
function dispatchNext(lane: BridgeLane): void {
  if (lane.activeRequestId !== null) return;
  const next = lane.pending.entries().next();
  if (next.done) return;

  const [id, entry] = next.value;
  const proc = lane.child;
  if (!proc || proc.killed || proc.exitCode !== null) {
    rejectAll(lane, "Swift bridge unavailable before request dispatch");
    return;
  }

  lane.activeRequestId = id;
  entry.process = proc;
  entry.timer = setTimeout(() => {
    if (lane.activeRequestId !== id || lane.pending.get(id) !== entry) return;
    lane.pending.delete(id);
    lane.activeRequestId = null;
    entry.timer = null;
    entry.process = null;
    entry.reject(new Error(`Swift bridge timed out after ${TIMEOUT.SWIFT / 1000}s`));
    terminateActiveProcess(lane, proc, "Swift bridge reset after active request timed out");
  }, TIMEOUT.SWIFT);

  try {
    proc.stdin!.write(entry.request + "\n");
  } catch (e) {
    lane.pending.delete(id);
    lane.activeRequestId = null;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.process = null;
    entry.reject(new Error(`Failed to write to Swift bridge: ${e}`));
    terminateActiveProcess(lane, proc, "Swift bridge reset after failed write");
    lane.launchFailed = true;
    lane.launchFailedAt = Date.now();
  }
}

function terminateActiveProcess(lane: BridgeLane, proc: ChildProcess, message: string): void {
  if (lane.child !== proc) return;
  lane.child = null;
  rejectAll(lane, message);
  if (!proc.killed) {
    proc.stdin!.end();
    proc.kill("SIGTERM");
  }
}

function closeBridgeLane(lane: BridgeLane): void {
  const processes = new Set([lane.child, lane.launchingChild]);
  const rejectLaunch = lane.launchReject;
  const launchTimer = lane.launchTimer;
  lane.child = null;
  lane.launchingChild = null;
  lane.launching = null;
  lane.launchReject = null;
  lane.launchTimer = null;
  if (launchTimer) clearTimeout(launchTimer);
  rejectAll(lane, "Swift bridge closed");
  rejectLaunch?.(new SwiftBridgeClosedError());
  for (const proc of processes) {
    if (proc && !proc.killed) {
      proc.stdin!.end();
      proc.kill("SIGTERM");
    }
  }
}

/** Gracefully shut down the persistent Swift process. */
export function closeSwiftBridge(): void {
  for (const lane of bridgeLanes) closeBridgeLane(lane);
}

// ── Public API ───────────────────────────────────────────────────────

export async function runSwift<T>(command: string, input: string): Promise<T> {
  const missing = await checkSwiftBridge();
  if (missing) throw new Error(missing);
  const lane = laneForCommand(command);

  // If persistent mode failed to launch, check if recovery is possible
  if (lane.launchFailed) {
    if (lane.launchRetryCount >= LAUNCH_MAX_RETRIES) {
      return runSwiftSingleShot<T>(command, input);
    }
    if (Date.now() - lane.launchFailedAt < LAUNCH_COOLDOWN_MS) {
      return runSwiftSingleShot<T>(command, input);
    }
    lane.launchFailed = false;
    lane.launchRetryCount++;
  }

  try {
    await ensureProcess(lane);
    lane.launchRetryCount = 0;
  } catch (error) {
    // An explicit shutdown must not be treated as a launch failure: falling
    // back here would spawn a new single-shot helper while closing.
    if (error instanceof SwiftBridgeClosedError) throw error;
    // Persistent mode unavailable — fall back to single-shot
    lane.launchFailed = true;
    lane.launchFailedAt = Date.now();
    return runSwiftSingleShot<T>(command, input);
  }

  const id = randomUUID();
  const request = `{"id":${JSON.stringify(id)},"command":${JSON.stringify(command)},"input":${input}}`;

  return new Promise<T>((resolve, reject) => {
    lane.pending.set(id, {
      request,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer: null,
      process: null,
    });
    dispatchNext(lane);
  });
}

// ── Single-shot fallback (original spawn-per-call) ───────────────────

function runSwiftSingleShot<T>(command: string, input: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const proc = spawn(BINARY_PATH, [command], {
      timeout: TIMEOUT.SWIFT,
    });

    let stdout = "";
    let stderr = "";
    let size = 0;

    proc.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BUFFER.SWIFT) {
        proc.kill("SIGTERM");
        reject(new Error(`Swift bridge output exceeded ${BUFFER.SWIFT} bytes`));
        return;
      }
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code, signal) => {
      if (signal === "SIGTERM") {
        reject(new Error(`Swift bridge timed out after ${TIMEOUT.SWIFT / 1000}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Swift bridge exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error("Swift bridge returned empty output"));
        return;
      }
      try {
        // Prototype pollution guard — same layered defence as persistent mode:
        // fast string pre-check + reviver that drops dangerous keys.
        if (containsDangerousKey(trimmed)) {
          reject(new Error("Swift bridge response rejected: suspicious payload"));
          return;
        }
        let poisoned = false;
        const parsed: unknown = JSON.parse(trimmed, (key, value) => {
          if (DANGEROUS_KEYS.has(key)) {
            poisoned = true;
            return undefined;
          }
          return value;
        });
        if (poisoned) {
          reject(new Error("Swift bridge response rejected: suspicious payload"));
          return;
        }
        resolve(parsed as T);
      } catch {
        reject(new Error(`Swift bridge returned invalid JSON: ${trimmed.slice(0, 200)}`));
      }
    });

    proc.on("error", (e) => {
      reject(e);
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
