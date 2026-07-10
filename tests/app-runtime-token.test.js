import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";

const originalHome = process.env.HOME;
const originalTokenPath = process.env.AIRMCP_APP_RUNTIME_TOKEN_PATH;
const tempHomes = [];

async function loadTokenModule(home) {
  process.env.HOME = home;
  jest.resetModules();
  return import("../dist/shared/app-runtime-token.js");
}

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalTokenPath === undefined) delete process.env.AIRMCP_APP_RUNTIME_TOKEN_PATH;
  else process.env.AIRMCP_APP_RUNTIME_TOKEN_PATH = originalTokenPath;
  jest.resetModules();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("app runtime token", () => {
  test("creates a per-install token with private permissions", async () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-token-"));
    tempHomes.push(home);

    const { APP_RUNTIME_TOKEN_PATH, ensureAppRuntimeToken } = await loadTokenModule(home);
    const token = ensureAppRuntimeToken();

    expect(APP_RUNTIME_TOKEN_PATH).toBe(join(home, "Library", "Application Support", "AirMCP", "http-token"));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(APP_RUNTIME_TOKEN_PATH, "utf8").trim()).toBe(token);
    expect(statSync(APP_RUNTIME_TOKEN_PATH).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "Library", "Application Support", "AirMCP")).mode & 0o777).toBe(0o700);
    expect(ensureAppRuntimeToken()).toBe(token);
  });

  test("reuses an existing token and repairs file mode", async () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-token-"));
    tempHomes.push(home);
    const dir = join(home, "Library", "Application Support", "AirMCP");
    const path = join(dir, "http-token");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "existing-token\n", { mode: 0o644 });

    const { ensureAppRuntimeToken } = await loadTokenModule(home);

    expect(ensureAppRuntimeToken()).toBe("existing-token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("honors an isolated app-runtime token path", async () => {
    const home = mkdtempSync(join(tmpdir(), "airmcp-token-"));
    tempHomes.push(home);
    const path = join(home, "acceptance-state", "http-token");
    process.env.AIRMCP_APP_RUNTIME_TOKEN_PATH = path;

    const { APP_RUNTIME_TOKEN_PATH, ensureAppRuntimeToken } = await loadTokenModule(home);
    const token = ensureAppRuntimeToken();

    expect(APP_RUNTIME_TOKEN_PATH).toBe(path);
    expect(readFileSync(path, "utf8").trim()).toBe(token);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
