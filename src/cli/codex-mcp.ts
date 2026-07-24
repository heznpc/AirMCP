import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { NPM_PACKAGE_SPECIFIER } from "../shared/config.js";
import { HOME, IDENTITY } from "../shared/constants.js";
import { ensureAppRuntimeToken } from "../shared/app-runtime-token.js";

export const CODEX_APP_OWNED_URL = `http://127.0.0.1:${IDENTITY.HTTP_PORT}/mcp`;
export type CodexAirmcpRuntimeShape =
  | "app-owned"
  | "app-owned-disabled"
  | "app-owned-pending-restart"
  | "direct"
  | "direct-disabled"
  | "unknown"
  | "missing";
type CodexConfigFileRuntimeShape = "app-owned" | "app-owned-disabled" | "direct" | "direct-disabled" | "unknown";
export type CodexAirmcpEnabledState = "enabled" | "disabled" | "missing" | "invalid";

interface CodexConfigPathSelection {
  absolutePath?: string;
  errorMessage?: string;
}

class CodexConfigPathError extends Error {
  override readonly name = "CodexConfigPathError";
}

function selectCodexConfigPath(env: NodeJS.ProcessEnv): CodexConfigPathSelection {
  const candidate = env.AIRMCP_CODEX_CONFIG_PATH
    ? env.AIRMCP_CODEX_CONFIG_PATH
    : env.CODEX_HOME
      ? join(env.CODEX_HOME, "config.toml")
      : join(env.HOME ?? env.USERPROFILE ?? HOME, ".codex", "config.toml");
  try {
    const absolutePath = resolve(candidate);
    if (basename(absolutePath) !== "config.toml") {
      return {
        errorMessage: "AIRMCP_CODEX_CONFIG_PATH must name config.toml because Codex only reads CODEX_HOME/config.toml",
      };
    }
    return { absolutePath };
  } catch {
    return { errorMessage: "The selected Codex config must be a valid filesystem path named config.toml" };
  }
}

/** Resolve one candidate for tests and callers that need explicit validation. */
export function resolveCodexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const selection = selectCodexConfigPath(env);
  if (selection.errorMessage) throw new CodexConfigPathError(selection.errorMessage);
  return selection.absolutePath!;
}

// Capture environment selection once without throwing during module import.
// Unrelated/config-only commands may import this module without touching Codex;
// the first actual Codex boundary below fails closed with the stored error.
const CODEX_CONFIG_SELECTION = selectCodexConfigPath(process.env);

function requireCodexConfigPath(): string {
  if (CODEX_CONFIG_SELECTION.errorMessage) {
    throw new CodexConfigPathError(CODEX_CONFIG_SELECTION.errorMessage);
  }
  return CODEX_CONFIG_SELECTION.absolutePath!;
}

export interface CodexProjectOverride {
  path: string;
  state: Exclude<CodexAirmcpEnabledState, "missing">;
}

export interface CodexAirmcpRegistrationState {
  globalConfigPath: string;
  globalState: CodexAirmcpEnabledState;
  /**
   * The nearest project-local AirMCP entry, when present. Codex gives this
   * entry precedence in that project; AirMCP deliberately never edits it from
   * a global enable/disable operation.
   */
  projectOverride?: CodexProjectOverride;
}

export interface CodexAirmcpEnabledResult extends CodexAirmcpRegistrationState {
  changed: boolean;
}

export interface CodexAirmcpConfigOptions {
  configPath?: string;
  projectDirectory?: string;
}

export interface ConfigureCodexAirmcpOptions {
  enabled?: boolean;
}

function runCodex(args: string[], usesConfig = true): string {
  const configPath = usesConfig ? requireCodexConfigPath() : undefined;
  return execFileSync("codex", args, {
    // `codex mcp get` resolves a trusted project's `.codex/config.toml` ahead
    // of the user config. AirMCP's setup owns only the persistent user entry,
    // so run from HOME and report project overrides separately.
    cwd: HOME,
    // Codex accepts a config directory rather than a config-file flag. Point
    // every CLI read/write at the same config.toml selected above, including
    // the AirMCP-only explicit path override used by isolated integrations.
    env: configPath ? { ...process.env, CODEX_HOME: dirname(configPath) } : process.env,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

interface CodexTomlSection {
  lines: string[];
  headerIndex: number;
  endIndex: number;
  enabledIndex?: number;
  enabled?: boolean;
  invalid: boolean;
}

function lineContent(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function locateCodexAirmcpSection(toml: string): CodexTomlSection | null {
  const lines = toml.split(/(?<=\n)/);
  const headers = lines
    .map((line, index) => ({ content: lineContent(line).trim(), index }))
    .filter(({ content }) => /^\[mcp_servers\.airmcp\](?:\s*#.*)?$/.test(content));
  if (headers.length === 0) return null;
  if (headers.length > 1) {
    return { lines, headerIndex: headers[0]!.index, endIndex: headers[0]!.index + 1, invalid: true };
  }

  const headerIndex = headers[0]!.index;
  let endIndex = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lineContent(lines[index]!))) {
      endIndex = index;
      break;
    }
  }

  let enabledIndex: number | undefined;
  let enabled: boolean | undefined;
  let invalid = false;
  for (let index = headerIndex + 1; index < endIndex; index += 1) {
    const content = lineContent(lines[index]!);
    if (!/^\s*enabled\s*=/.test(content)) continue;
    if (enabledIndex !== undefined) {
      invalid = true;
      continue;
    }
    enabledIndex = index;
    const match = content.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/i);
    if (!match) {
      invalid = true;
      continue;
    }
    enabled = match[1]!.toLowerCase() === "true";
  }

  return { lines, headerIndex, endIndex, enabledIndex, enabled, invalid };
}

export function codexConfigTomlEnabledState(toml: string): CodexAirmcpEnabledState {
  const section = locateCodexAirmcpSection(toml);
  if (!section) return "missing";
  if (section.invalid) return "invalid";
  // Codex defaults an existing MCP server to enabled when the key is absent.
  return section.enabled === false ? "disabled" : "enabled";
}

/**
 * Toggle only `[mcp_servers.airmcp].enabled`, preserving every other setting
 * byte-for-byte and leaving nested sections such as `.env` untouched.
 */
export function updateCodexAirmcpEnabledInToml(
  toml: string,
  enabled: boolean,
): { toml: string; found: boolean; changed: boolean } {
  const section = locateCodexAirmcpSection(toml);
  if (!section) return { toml, found: false, changed: false };
  if (section.invalid) {
    throw new Error("Codex config has an invalid or duplicate [mcp_servers.airmcp] enabled setting");
  }
  if ((section.enabled ?? true) === enabled) return { toml, found: true, changed: false };

  if (section.enabledIndex !== undefined) {
    const originalLine = section.lines[section.enabledIndex]!;
    const ending = originalLine.match(/\r?\n$/)?.[0] ?? "";
    const content = lineContent(originalLine);
    section.lines[section.enabledIndex] =
      content.replace(/^(\s*enabled\s*=\s*)(true|false)(\s*(?:#.*)?)$/i, `$1${String(enabled)}$3`) + ending;
  } else {
    const headerLine = section.lines[section.headerIndex]!;
    const defaultEnding = toml.includes("\r\n") ? "\r\n" : "\n";
    const headerEnding = headerLine.match(/\r?\n$/)?.[0];
    if (headerEnding) {
      section.lines.splice(section.headerIndex + 1, 0, `enabled = ${String(enabled)}${headerEnding}`);
    } else {
      section.lines[section.headerIndex] = headerLine + defaultEnding;
      section.lines.splice(section.headerIndex + 1, 0, `enabled = ${String(enabled)}`);
    }
  }
  return { toml: section.lines.join(""), found: true, changed: true };
}

function readCodexEnabledState(configPath: string): CodexAirmcpEnabledState {
  if (!existsSync(configPath)) return "missing";
  return codexConfigTomlEnabledState(readFileSync(configPath, "utf8"));
}

function findCodexProjectOverride(startDirectory: string, globalConfigPath: string): CodexProjectOverride | undefined {
  let directory = resolve(startDirectory);
  const normalizedGlobalPath = resolve(globalConfigPath);
  while (true) {
    const candidate = join(directory, ".codex", "config.toml");
    if (resolve(candidate) !== normalizedGlobalPath && existsSync(candidate)) {
      const state = readCodexEnabledState(candidate);
      if (state !== "missing") return { path: candidate, state };
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function inspectCodexAirmcpRegistration(options: CodexAirmcpConfigOptions = {}): CodexAirmcpRegistrationState {
  const globalConfigPath = options.configPath ?? requireCodexConfigPath();
  const projectOverride = findCodexProjectOverride(options.projectDirectory ?? process.cwd(), globalConfigPath);
  return {
    globalConfigPath,
    globalState: readCodexEnabledState(globalConfigPath),
    ...(projectOverride ? { projectOverride } : {}),
  };
}

export function setCodexAirmcpEnabled(
  enabled: boolean,
  options: CodexAirmcpConfigOptions = {},
): CodexAirmcpEnabledResult {
  const before = inspectCodexAirmcpRegistration(options);
  if (before.globalState === "missing") return { ...before, changed: false };
  if (before.globalState === "invalid") {
    throw new Error("Codex config has an invalid or duplicate [mcp_servers.airmcp] enabled setting");
  }

  const original = readFileSync(before.globalConfigPath, "utf8");
  const updated = updateCodexAirmcpEnabledInToml(original, enabled);
  if (updated.changed) {
    atomicReplaceFile(before.globalConfigPath, updated.toml, statSync(before.globalConfigPath).mode & 0o777);
  }
  return {
    ...inspectCodexAirmcpRegistration(options),
    changed: updated.changed,
  };
}

function atomicReplaceFile(path: string, content: string, mode: number): void {
  const temporaryPath = join(dirname(path), `.${basename(path)}.airmcp-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function isCodexCliAvailable(): boolean {
  try {
    // Executable detection does not read or mutate config. Delaying config
    // validation lets client setup report the selected-path error accurately
    // instead of misclassifying a present Codex CLI as absent.
    runCodex(["--version"], false);
    return true;
  } catch {
    return false;
  }
}

export function getCodexAirmcpConfig(): string | null {
  try {
    return runCodex(["mcp", "get", "airmcp"]);
  } catch (error) {
    if (error instanceof CodexConfigPathError) throw error;
    return null;
  }
}

export function isCodexAirmcpConfigured(): boolean {
  return getCodexAirmcpConfig() !== null;
}

function codexCliRuntimeShape(config: string | null): Exclude<CodexAirmcpRuntimeShape, "app-owned-pending-restart"> {
  if (!config) return "missing";
  const disabled = /\benabled:\s*false\b/i.test(config);
  const command = config.match(/^\s*command:\s*(.*?)\s*$/m)?.[1] ?? "";
  const args = config.match(/^\s*args:\s*(.*?)\s*$/m)?.[1] ?? "";
  const expectedDirectArgs = `-y ${NPM_PACKAGE_SPECIFIER}`;
  const expectedAppArgs = `${expectedDirectArgs} connect --url ${CODEX_APP_OWNED_URL}`;
  if (
    command === "npx" &&
    args === expectedAppArgs &&
    config.includes("transport: stdio") &&
    config.includes("AIRMCP_HTTP_TOKEN")
  ) {
    return disabled ? "app-owned-disabled" : "app-owned";
  }
  if (command === "npx" && args === expectedDirectArgs && config.includes("transport: stdio")) {
    return disabled ? "direct-disabled" : "direct";
  }
  return "unknown";
}

function sectionBody(toml: string, header: string): string {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Extract the AIRMCP_HTTP_TOKEN value from a Codex `[mcp_servers.airmcp]`
 *  block, covering BOTH the standalone `[mcp_servers.airmcp.env]` subsection
 *  form and the inline-table `env = { AIRMCP_HTTP_TOKEN = "..." }` form.
 *  Returns the literal token string, or null when absent. */
function extractCodexHttpToken(serverBody: string, envBody: string): string | null {
  // Standalone subsection: AIRMCP_HTTP_TOKEN = "value"
  const subsection = envBody.match(/AIRMCP_HTTP_TOKEN\s*=\s*"([^"]*)"/);
  if (subsection) return subsection[1] ?? null;
  // Inline table on the server block: env = { ..., AIRMCP_HTTP_TOKEN = "value", ... }
  const inline = serverBody.match(/AIRMCP_HTTP_TOKEN\s*=\s*"([^"]*)"/);
  if (inline) return inline[1] ?? null;
  return null;
}

function extractTomlString(serverBody: string, key: string): string | null {
  const match = serverBody.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*(?:#.*)?$`, "m"));
  if (!match?.[1]) return null;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function extractTomlStringArray(serverBody: string, key: string): string[] | null {
  const match = serverBody.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]\\s*(?:#.*)?$`, "m"));
  if (!match) return null;
  const values: string[] = [];
  const content = match[1] ?? "";
  const stringPattern = /"(?:\\.|[^"\\])*"/g;
  let cursor = 0;
  for (const item of content.matchAll(stringPattern)) {
    const index = item.index ?? 0;
    if (!/^[\s,]*$/.test(content.slice(cursor, index))) return null;
    try {
      const value: unknown = JSON.parse(item[0]);
      if (typeof value !== "string") return null;
      values.push(value);
    } catch {
      return null;
    }
    cursor = index + item[0].length;
  }
  if (!/^[\s,]*$/.test(content.slice(cursor))) return null;
  return values;
}

function sameStrings(actual: string[] | null, expected: readonly string[]): boolean {
  return (
    actual !== null && actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

/**
 * Classify a Codex `config.toml`. When `liveToken` is provided, an app-owned
 * proxy entry is only reported as `"app-owned"` if its stored token VALUE
 * matches the live runtime token — a stale/wrong token falls through to
 * `"unknown"` so the runtime repairs it. When `liveToken` is omitted the
 * function is a pure structural parse (token presence only).
 */
export function codexConfigTomlRuntimeShape(toml: string, liveToken?: string): CodexConfigFileRuntimeShape {
  const server = sectionBody(toml, "[mcp_servers.airmcp]");
  if (!server) return "unknown";
  const env = sectionBody(toml, "[mcp_servers.airmcp.env]");
  const command = extractTomlString(server, "command");
  const args = extractTomlStringArray(server, "args");
  const configToken = extractCodexHttpToken(server, env);
  const hasToken = configToken !== null;
  const disabled = codexConfigTomlEnabledState(toml) === "disabled";
  if (
    command === "npx" &&
    sameStrings(args, ["-y", NPM_PACKAGE_SPECIFIER, "connect", "--url", CODEX_APP_OWNED_URL]) &&
    hasToken
  ) {
    // Repair gate: a stale/wrong token must not pass as app-owned.
    if (liveToken !== undefined && configToken !== liveToken) return "unknown";
    return disabled ? "app-owned-disabled" : "app-owned";
  }
  if (command === "npx" && sameStrings(args, ["-y", NPM_PACKAGE_SPECIFIER])) {
    return disabled ? "direct-disabled" : "direct";
  }
  return "unknown";
}

function codexConfigFileRuntimeShape(): CodexConfigFileRuntimeShape {
  const configPath = requireCodexConfigPath();
  try {
    if (!existsSync(configPath)) return "unknown";
    // Pass the live runtime token so a config carrying a stale/wrong token
    // is not classified app-owned — it falls through and gets repaired.
    return codexConfigTomlRuntimeShape(readFileSync(configPath, "utf8"), ensureAppRuntimeToken());
  } catch {
    return "unknown";
  }
}

export function codexAirmcpRuntimeShape(): CodexAirmcpRuntimeShape {
  const cliShape = codexCliRuntimeShape(getCodexAirmcpConfig());
  if (cliShape === "app-owned" || cliShape === "app-owned-disabled") return cliShape;

  const fileShape = codexConfigFileRuntimeShape();
  if (fileShape === "app-owned") return "app-owned-pending-restart";
  if (fileShape === "app-owned-disabled" || fileShape === "direct" || fileShape === "direct-disabled") return fileShape;
  if (cliShape === "missing" && readCodexEnabledState(requireCodexConfigPath()) !== "missing") return "unknown";
  return cliShape;
}

interface CodexStdioSnapshot {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

interface CodexHttpSnapshot {
  type: "streamable_http";
  url: string;
  bearerTokenEnvVar?: string;
  enabled: boolean;
}

type CodexMcpSnapshot = CodexStdioSnapshot | CodexHttpSnapshot;

interface CodexConfigFileSnapshot {
  content: string;
  mode: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStringRecord(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseCodexMcpSnapshot(raw: string): CodexMcpSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codex returned an invalid JSON snapshot for the existing AirMCP entry");
  }
  if (!isRecord(parsed) || !isRecord(parsed.transport)) {
    throw new Error("Codex returned an unsupported snapshot for the existing AirMCP entry");
  }
  const enabled = typeof parsed.enabled === "boolean" ? parsed.enabled : true;
  const transport = parsed.transport;
  if (transport.type === "stdio") {
    const env = parseStringRecord(transport.env);
    if (
      typeof transport.command !== "string" ||
      !Array.isArray(transport.args) ||
      transport.args.some((arg) => typeof arg !== "string") ||
      env === null
    ) {
      throw new Error("Codex returned an unsupported stdio snapshot for the existing AirMCP entry");
    }
    return {
      type: "stdio",
      command: transport.command,
      args: transport.args as string[],
      env,
      enabled,
    };
  }
  if (transport.type === "streamable_http") {
    if (
      typeof transport.url !== "string" ||
      (transport.bearer_token_env_var !== null &&
        transport.bearer_token_env_var !== undefined &&
        typeof transport.bearer_token_env_var !== "string")
    ) {
      throw new Error("Codex returned an unsupported HTTP snapshot for the existing AirMCP entry");
    }
    return {
      type: "streamable_http",
      url: transport.url,
      ...(typeof transport.bearer_token_env_var === "string"
        ? { bearerTokenEnvVar: transport.bearer_token_env_var }
        : {}),
      enabled,
    };
  }
  throw new Error("Codex returned an unsupported transport snapshot for the existing AirMCP entry");
}

function captureCodexMcpSnapshot(): CodexMcpSnapshot {
  let raw: string;
  try {
    raw = runCodex(["mcp", "get", "airmcp", "--json"]);
  } catch (cause) {
    if (cause instanceof CodexConfigPathError) throw cause;
    throw new Error("Codex could not snapshot the existing AirMCP entry; replacement was not attempted", { cause });
  }
  return parseCodexMcpSnapshot(raw);
}

function captureCodexConfigFileSnapshot(): CodexConfigFileSnapshot | null {
  const configPath = requireCodexConfigPath();
  if (!existsSync(configPath)) return null;
  return {
    content: readFileSync(configPath, "utf8"),
    mode: statSync(configPath).mode & 0o777,
  };
}

function restoreArgs(snapshot: CodexMcpSnapshot): string[] {
  if (snapshot.type === "stdio") {
    const envArgs = Object.entries(snapshot.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
    return ["mcp", "add", ...envArgs, "airmcp", "--", snapshot.command, ...snapshot.args];
  }
  return [
    "mcp",
    "add",
    "airmcp",
    "--url",
    snapshot.url,
    ...(snapshot.bearerTokenEnvVar ? ["--bearer-token-env-var", snapshot.bearerTokenEnvVar] : []),
  ];
}

function requireEnabledState(enabled: boolean): void {
  if (enabled) return;
  const toggled = setCodexAirmcpEnabled(false);
  if (toggled.globalState === "missing") {
    throw new Error(`Codex did not write the expected global AirMCP entry at ${toggled.globalConfigPath}`);
  }
}

function replaceCodexMcpWithRollback(
  snapshot: CodexMcpSnapshot,
  configFileSnapshot: CodexConfigFileSnapshot | null,
  replacementArgs: string[],
  enabled: boolean,
): void {
  try {
    // Keep remove inside the transaction boundary: Codex could mutate the
    // config and still return a non-zero status.
    runCodex(["mcp", "remove", "airmcp"]);
    runCodex(replacementArgs);
    requireEnabledState(enabled);
  } catch (replacementCause) {
    try {
      if (configFileSnapshot) {
        // Codex's JSON surface intentionally omits some TOML fields (cwd,
        // timeouts, tool filters, env indirection). Restoring the complete
        // pre-remove file is the only lossless rollback for the user config.
        atomicReplaceFile(requireCodexConfigPath(), configFileSnapshot.content, configFileSnapshot.mode);
      } else {
        // A nonstandard Codex home can expose an entry while the configured
        // global path is absent. Fall back to the supported transport fields.
        try {
          runCodex(["mcp", "remove", "airmcp"]);
        } catch {
          // A missing partial entry is the normal failure mode.
        }
        runCodex(restoreArgs(snapshot));
        requireEnabledState(snapshot.enabled);
      }
    } catch (restorationCause) {
      throw new Error(`Codex failed to replace AirMCP and failed to restore the previous ${snapshot.type} entry`, {
        cause: restorationCause,
      });
    }
    throw new Error(`Codex failed to replace AirMCP; the previous ${snapshot.type} entry was restored`, {
      cause: replacementCause,
    });
  }
}

function addOrReplaceCodexMcp(shape: CodexAirmcpRuntimeShape, replacementArgs: string[], enabled: boolean): void {
  if (shape === "missing") {
    runCodex(replacementArgs);
    requireEnabledState(enabled);
    return;
  }
  const snapshot = captureCodexMcpSnapshot();
  const configFileSnapshot = captureCodexConfigFileSnapshot();
  replaceCodexMcpWithRollback(snapshot, configFileSnapshot, replacementArgs, enabled);
}

export function configureCodexAirmcp(options: ConfigureCodexAirmcpOptions = {}): "already-configured" | "configured" {
  const enabled = options.enabled ?? true;
  const token = ensureAppRuntimeToken();
  const shape = codexAirmcpRuntimeShape();
  if (shape === "app-owned" || shape === "app-owned-disabled" || shape === "app-owned-pending-restart") {
    const toggled = setCodexAirmcpEnabled(enabled);
    if (toggled.globalState === "missing") {
      if (enabled) return "already-configured";
      throw new Error(
        "Codex reports AirMCP from a non-global config; the global AirMCP entry is missing and was not changed",
      );
    }
    return toggled.changed ? "configured" : "already-configured";
  }
  addOrReplaceCodexMcp(
    shape,
    [
      "mcp",
      "add",
      "--env",
      `AIRMCP_HTTP_TOKEN=${token}`,
      "airmcp",
      "--",
      "npx",
      "-y",
      NPM_PACKAGE_SPECIFIER,
      "connect",
      "--url",
      CODEX_APP_OWNED_URL,
    ],
    enabled,
  );
  return "configured";
}

export function configureCodexAirmcpDirect(
  options: ConfigureCodexAirmcpOptions = {},
): "already-configured" | "configured" {
  const enabled = options.enabled ?? true;
  const shape = codexAirmcpRuntimeShape();
  if (shape === "direct" || shape === "direct-disabled") {
    const toggled = setCodexAirmcpEnabled(enabled);
    if (toggled.globalState === "missing") {
      if (enabled) return "already-configured";
      throw new Error(
        "Codex reports AirMCP from a non-global config; the global AirMCP entry is missing and was not changed",
      );
    }
    return toggled.changed ? "configured" : "already-configured";
  }
  addOrReplaceCodexMcp(shape, ["mcp", "add", "airmcp", "--", "npx", "-y", NPM_PACKAGE_SPECIFIER], enabled);
  return "configured";
}

export function codexManualSetupCommand(): string {
  return (
    "codex mcp add --env AIRMCP_HTTP_TOKEN=<token> airmcp -- npx -y " +
    NPM_PACKAGE_SPECIFIER +
    " connect --url " +
    CODEX_APP_OWNED_URL
  );
}

export function codexDirectManualSetupCommand(): string {
  return "codex mcp add airmcp -- npx -y " + NPM_PACKAGE_SPECIFIER;
}

export function directStdioEntry(): {
  command: string;
  args: string[];
} {
  return {
    command: "npx",
    args: ["-y", NPM_PACKAGE_SPECIFIER],
  };
}

export function stdioProxyEntry(token = ensureAppRuntimeToken()): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: "npx",
    args: ["-y", NPM_PACKAGE_SPECIFIER, "connect", "--url", CODEX_APP_OWNED_URL],
    env: {
      AIRMCP_HTTP_TOKEN: token,
    },
  };
}
