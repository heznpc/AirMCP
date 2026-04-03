/**
 * Centralized constants for AirMCP.
 *
 * All magic numbers, API URLs, timeouts, buffer sizes, and limits live here.
 * Each constant can be overridden via environment variable where noted.
 *
 * When APIs or models change versions, update ONLY this file.
 */

import { join } from "node:path";

// ── Helper ───────────────────────────────────────────────────────────

export const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const parsed = parseInt(v, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function resolveTilde(p: string): string {
  return p.startsWith("~/") ? join(HOME, p.slice(2)) : p;
}

// ══════════════════════════════════════════════════════════════════════
// API URLs — change here when services update endpoints
// ══════════════════════════════════════════════════════════════════════

export const API = {
  /** Open-Meteo weather forecast */
  WEATHER: envStr("AIRMCP_WEATHER_API_URL", "https://api.open-meteo.com/v1/forecast"),
  /** Open-Meteo geocoding */
  GEOCODING: envStr("AIRMCP_GEOCODING_API_URL", "https://geocoding-api.open-meteo.com/v1/search"),
  /** Nominatim reverse geocoding */
  REVERSE_GEOCODE: envStr("AIRMCP_REVERSE_GEOCODE_API_URL", "https://nominatim.openstreetmap.org/reverse"),
  /** Gemini embedding API base */
  GEMINI_BASE: envStr("AIRMCP_GEMINI_API_URL", "https://generativelanguage.googleapis.com/v1beta/models"),
} as const;

// ══════════════════════════════════════════════════════════════════════
// MODEL NAMES — change here when models are upgraded
// ══════════════════════════════════════════════════════════════════════

export const MODELS = {
  /** Gemini embedding model name (GA — update when newer stable version is released) */
  GEMINI_EMBEDDING: envStr("AIRMCP_EMBEDDING_MODEL", "gemini-embedding-2"),
  /** Embedding output dimension (256/512/1024/2048/3072). 256 is optimal for tool/note search. */
  EMBEDDING_DIM: envInt("AIRMCP_EMBEDDING_DIM", 256),
} as const;

// ══════════════════════════════════════════════════════════════════════
// TIMEOUTS (milliseconds)
// ══════════════════════════════════════════════════════════════════════

export const TIMEOUT = {
  /** JXA osascript execution */
  JXA: envInt("AIRMCP_TIMEOUT_JXA", 30_000),
  /** Swift bridge execution */
  SWIFT: envInt("AIRMCP_TIMEOUT_SWIFT", 60_000),
  /** SIGKILL grace after SIGTERM */
  KILL_GRACE: 3_000,
  /** Geocoding / reverse geocoding API calls */
  GEOCODE: envInt("AIRMCP_TIMEOUT_GEOCODE", 10_000),
  /** Gemini single embedding request */
  EMBED_SINGLE: 15_000,
  /** Gemini batch embedding request */
  EMBED_BATCH: 30_000,
  /** Messages AppleScript send */
  MESSAGE_SEND: 15_000,
  /** GWS CLI default timeout */
  GWS: envInt("AIRMCP_TIMEOUT_GWS", 15_000),
  /** Quick CLI binary availability probe */
  CLI_PROBE: 5_000,
  /** Shortcuts list enumeration */
  SHORTCUTS_LIST: 10_000,
  /** HTTP session idle TTL */
  SESSION_IDLE: envInt("AIRMCP_SESSION_IDLE_TTL", 5 * 60_000),
  /** HTTP session cleanup interval */
  SESSION_CLEANUP: 60_000,
  /** Vector store staleness threshold */
  VECTOR_STALE: 30 * 60_000,
  /** Semantic index cooldown after failure */
  INDEX_COOLDOWN: envInt("AIRMCP_INDEX_COOLDOWN", 5 * 60_000),
} as const;

// ══════════════════════════════════════════════════════════════════════
// BUFFER SIZES (bytes)
// ══════════════════════════════════════════════════════════════════════

export const BUFFER = {
  /** JXA osascript max stdout */
  JXA: envInt("AIRMCP_BUFFER_JXA", 10 * 1024 * 1024),
  /** Swift bridge max stdout */
  SWIFT: envInt("AIRMCP_BUFFER_SWIFT", 10 * 1024 * 1024),
  /** GWS CLI max stdout */
  GWS: 10 * 1024 * 1024,
  /** Clipboard content max chars */
  CLIPBOARD: 5_000_000,
  /** Screenshot/capture max bytes */
  CAPTURE: 5 * 1024 * 1024,
} as const;

// ══════════════════════════════════════════════════════════════════════
// CONCURRENCY & CIRCUIT BREAKER
// ══════════════════════════════════════════════════════════════════════

let _jxaSlots: number | undefined;
let _cbThreshold: number | undefined;
let _cbOpenMs: number | undefined;

export const CONCURRENCY = {
  /** Max parallel JXA/osascript processes (lazy-once — deferred until first use so config can set env vars) */
  get JXA_SLOTS() {
    return (_jxaSlots ??= envInt("AIRMCP_JXA_CONCURRENCY", 3));
  },
  /** Max parallel Swift bridge processes */
  SWIFT_SLOTS: 2 as const,
  /** Max parallel GWS CLI processes */
  GWS_SLOTS: 3 as const,
  /** JXA retry attempts */
  JXA_RETRIES: 2 as const,
  /** JXA retry delays (ms) */
  JXA_RETRY_DELAYS: [500, 1000] as readonly number[],
  /** Circuit breaker: failures before open (lazy-once — deferred until first use) */
  get CB_THRESHOLD() {
    return (_cbThreshold ??= envInt("AIRMCP_CB_THRESHOLD", 3));
  },
  /** Circuit breaker: open duration ms (lazy-once — deferred until first use) */
  get CB_OPEN_MS() {
    return (_cbOpenMs ??= envInt("AIRMCP_CB_OPEN_MS", 60_000));
  },
  /** Circuit breaker: max apps tracked */
  CB_CACHE_SIZE: 50 as const,
};

// ══════════════════════════════════════════════════════════════════════
// LIMITS
// ══════════════════════════════════════════════════════════════════════

export const LIMITS = {
  /** Max HTTP sessions */
  HTTP_SESSIONS: envInt("AIRMCP_MAX_SESSIONS", 50),
  /** Max dynamic shortcut tools */
  DYNAMIC_SHORTCUTS: 50,
  /** Max email recipients per send */
  MAIL_RECIPIENTS: 20,
  /** Gemini batch embedding chunk size */
  EMBED_BATCH_SIZE: 100,
  /** Semantic search default topK */
  SEARCH_TOP_K: 10,
  /** Semantic search similarity threshold */
  SEARCH_THRESHOLD: 0.5,
  /** Max notes for scan_notes bulk operation */
  NOTES_BULK_SCAN: 500,
  /** Max reminders for context snapshot */
  SNAPSHOT_REMINDERS: 500,
  /** Embedding cache memory cap in MB (env: AIRMCP_EMBED_CACHE_MAX_MB) */
  EMBED_CACHE_MAX_MB: envInt("AIRMCP_EMBED_CACHE_MAX_MB", 256),
} as const;

// ══════════════════════════════════════════════════════════════════════
// IDENTITY
// ══════════════════════════════════════════════════════════════════════

export const IDENTITY = {
  /** User-Agent for HTTP requests to external APIs */
  USER_AGENT: envStr("AIRMCP_USER_AGENT", "AirMCP/2.6 (https://github.com/heznpc/AirMCP)"),
  /** Default HTTP server port */
  HTTP_PORT: envInt("AIRMCP_HTTP_PORT", 3847),
} as const;

// ══════════════════════════════════════════════════════════════════════
// FILE PATHS
// ══════════════════════════════════════════════════════════════════════

export const PATHS = {
  /** Config directory */
  CONFIG_DIR: join(HOME, ".config", "airmcp"),
  /** User config file */
  CONFIG: resolveTilde(envStr("AIRMCP_CONFIG_PATH", "~/.config/airmcp/config.json")),
  /** HITL socket */
  HITL_SOCKET: join(HOME, ".config", "airmcp", "hitl.sock"),
  /** Vector store directory */
  VECTOR_STORE: join(HOME, ".airmcp"),
  /** Usage profile */
  USAGE_PROFILE: join(HOME, ".airmcp", "profile.json"),
  /** Swift bridge binary (relative to project root) */
  SWIFT_BRIDGE: "../../swift/.build/release/AirMcpBridge",
} as const;
