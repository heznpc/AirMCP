import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { HOME } from "./constants.js";

export const APP_RUNTIME_TOKEN_PATH = join(HOME, "Library", "Application Support", "AirMCP", "http-token");

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function readTokenFile(): string {
  return readFileSync(APP_RUNTIME_TOKEN_PATH, "utf8").trim();
}

function writeTokenExclusively(token: string): boolean {
  mkdirSync(dirname(APP_RUNTIME_TOKEN_PATH), { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(APP_RUNTIME_TOKEN_PATH, "wx", 0o600);
    try {
      writeFileSync(fd, `${token}\n`, { encoding: "utf8" });
    } finally {
      closeSync(fd);
    }
    chmodSync(APP_RUNTIME_TOKEN_PATH, 0o600);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "EEXIST") return false;
    throw new Error(`Failed to create AirMCP app runtime token at ${APP_RUNTIME_TOKEN_PATH}`, { cause: error });
  }
}

export function ensureAppRuntimeToken(): string {
  if (existsSync(APP_RUNTIME_TOKEN_PATH)) {
    const existing = readTokenFile();
    if (existing) {
      chmodSync(APP_RUNTIME_TOKEN_PATH, 0o600);
      return existing;
    }
  }

  const token = createToken();
  if (writeTokenExclusively(token)) return token;

  const raced = readTokenFile();
  if (!raced) throw new Error(`AirMCP app runtime token exists but is empty: ${APP_RUNTIME_TOKEN_PATH}`);
  chmodSync(APP_RUNTIME_TOKEN_PATH, 0o600);
  return raced;
}
