import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function commandFailure(command, args, result) {
  const detail = String(result.stderr || result.stdout || "command failed").trim().slice(0, 2_000);
  return new Error(`${command} ${args.join(" ")} failed (${result.status ?? "signal"}): ${detail}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) throw commandFailure(command, args, result);
  return String(result.stdout ?? "");
}

function parsePackJson(output, packageRoot) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  const json = start >= 0 && end > start ? output.slice(start, end + 1) : output;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `npm pack did not return JSON for ${packageRoot}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry?.filename) throw new Error(`npm pack did not report a filename for ${packageRoot}`);
  return entry;
}

export function sha512Sri(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/** Pack exactly what `npm publish` would upload and calculate its registry SRI. */
export function inspectLocalPackage(packageRoot, { npmCommand = "npm" } = {}) {
  const root = resolve(packageRoot);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error(`package identity is missing in ${join(root, "package.json")}`);
  }

  const destination = mkdtempSync(join(tmpdir(), "airmcp-publish-identity-"));
  try {
    const output = run(npmCommand, ["pack", "--json", "--pack-destination", destination], { cwd: root });
    const packed = parsePackJson(output, root);
    const tarball = join(destination, packed.filename);
    return {
      name: pkg.name,
      version: pkg.version,
      integrity: sha512Sri(readFileSync(tarball)),
    };
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

function parsePublishedJson(output, label) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} metadata was not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    version: parsed?.version,
    integrity: parsed?.["dist.integrity"] ?? parsed?.dist?.integrity,
    gitHead: parsed?.gitHead,
  };
}

/** Query immutable registry identity. A network/auth failure is never treated as "missing". */
export function queryPublishedIdentity(name, version, { npmCommand = "npm" } = {}) {
  const spec = `${name}@${version}`;
  const args = ["view", spec, "version", "dist.integrity", "gitHead", "--json"];
  const result = spawnSync(npmCommand, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/\bE404\b|404 Not Found|is not in this registry/i.test(output)) return null;
    throw commandFailure(npmCommand, args, result);
  }
  return parsePublishedJson(String(result.stdout ?? ""), spec);
}

export function assertPublishedIdentity({ local, published, expectedGitHead, label = `${local.name}@${local.version}` }) {
  if (!published) throw new Error(`${label} is not published`);
  if (published.version !== local.version) {
    throw new Error(`${label} registry version differs from the local package`);
  }
  if (published.integrity !== local.integrity) {
    throw new Error(`${label} registry SRI differs from the local npm tarball`);
  }
  if (published.gitHead !== expectedGitHead) {
    throw new Error(`${label} registry gitHead differs from the expected release SHA`);
  }
  return true;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Registry reads can lag a successful immutable publish. Retry only in the
 * explicitly post-publish path: a complete but mismatched SRI/gitHead remains
 * an immediate hard failure, while missing/incomplete/transient metadata gets
 * a bounded window to converge.
 */
export function waitForPublishedIdentity({
  local,
  expectedGitHead,
  timeoutMs = 60_000,
  retryDelayMs = 2_000,
  npmCommand = "npm",
  query = queryPublishedIdentity,
  now = Date.now,
  sleep = sleepSync,
  label = `${local.name}@${local.version}`,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error("publish retry timeout must be non-negative");
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) throw new Error("publish retry delay must be positive");

  const deadline = now() + timeoutMs;
  let lastPublished = null;
  let lastQueryError = null;

  while (true) {
    let published = null;
    try {
      published = query(local.name, local.version, { npmCommand });
    } catch (error) {
      lastQueryError = error;
    }

    if (published) {
      lastPublished = published;
      if (published.version !== undefined && published.version !== local.version) {
        assertPublishedIdentity({ local, published, expectedGitHead, label });
      }
      if (published.integrity !== undefined && published.integrity !== local.integrity) {
        assertPublishedIdentity({ local, published, expectedGitHead, label });
      }
      if (published.gitHead !== undefined && published.gitHead !== expectedGitHead) {
        assertPublishedIdentity({ local, published, expectedGitHead, label });
      }
      if (published.version && published.integrity && published.gitHead) {
        assertPublishedIdentity({ local, published, expectedGitHead, label });
        return published;
      }
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    sleep(Math.min(retryDelayMs, remaining));
  }

  if (lastPublished) assertPublishedIdentity({ local, published: lastPublished, expectedGitHead, label });
  if (lastQueryError) throw new Error(`${label} registry metadata remained unavailable after bounded retry`);
  throw new Error(`${label} was not visible after bounded registry retry`);
}

export function verifyPublishedIdentity({
  packageRoot,
  expectedGitHead,
  allowMissing = false,
  npmCommand = "npm",
  retryTimeoutMs = 0,
}) {
  if (!/^[0-9a-f]{40}$/i.test(expectedGitHead)) {
    throw new Error("expected release SHA must be a full 40-character Git commit SHA");
  }
  const local = inspectLocalPackage(packageRoot, { npmCommand });
  if (retryTimeoutMs > 0) {
    if (allowMissing) throw new Error("allowMissing cannot be combined with post-publish registry retry");
    const publishedIdentity = waitForPublishedIdentity({
      local,
      expectedGitHead,
      timeoutMs: retryTimeoutMs,
      npmCommand,
    });
    return { published: true, local, publishedIdentity };
  }
  const published = queryPublishedIdentity(local.name, local.version, { npmCommand });
  if (!published) {
    if (allowMissing) return { published: false, local };
    throw new Error(`${local.name}@${local.version} is not published`);
  }
  assertPublishedIdentity({ local, published, expectedGitHead });
  return { published: true, local, publishedIdentity: published };
}
