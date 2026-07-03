// Power Automate Cloud Flow HTTP client. Pure, transport-only logic so it can
// be unit-tested by stubbing global.fetch (see tests/powerautomate.test.js),
// the same split AirMCP uses for maps/api.ts.
//
// Ported from newtria's cloudflow_trigger tool (Apache-2.0, same author),
// relicensed MIT.
//
// Cloud Flow auth quirks (verified vs Microsoft Learn 2026-04-29 doc):
//   - OAuth scope MUST use a double slash before .default:
//       https://service.flow.microsoft.com//.default
//     Single slash returns "MisMatchingOAuthClaims" because the audience URL
//     itself ends with '/', so <audience>/.default is naturally //.default.
//   - audience claim: https://service.flow.microsoft.com/
//   - "Specific users in tenant" mode requires an `oid` claim in the token.
//   - A SAS URL embeds a `sig` query param; treat it as secret-equivalent.

export const CLOUDFLOW_HARD_TIMEOUT_MS = 120_000; // Cloud Flow Response action cap
export const CLOUDFLOW_DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const CLOUDFLOW_HARD_MAX_RESPONSE_BYTES = 100 * 1024 * 1024; // 100 MiB ceiling

export type CloudFlowAuth = { type: "sas" } | { type: "oauth"; bearer: string };

export interface CloudFlowRequest {
  url: string;
  auth: CloudFlowAuth;
  body?: Record<string, unknown>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface CloudFlowResult {
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
  truncated: boolean;
  totalBytes: number;
}

/** Raised for network-layer failures (including timeout/abort). */
export class CloudFlowError extends Error {
  constructor(
    message: string,
    readonly aborted: boolean,
  ) {
    super(message);
    this.name = "CloudFlowError";
  }
}

/**
 * POST to a Power Automate Cloud Flow HTTP trigger URL. Resolves with the
 * (possibly truncated) response for any HTTP status; throws CloudFlowError
 * only on a network/timeout failure.
 */
export async function triggerCloudFlow(req: CloudFlowRequest): Promise<CloudFlowResult> {
  // Validate the URL ourselves before handing it to fetch. A SAS URL carries
  // the `sig` secret in its query string, and fetch's own parse error echoes
  // the FULL url in its message — so a URL that slipped past the caller's
  // validation but fails WHATWG parsing would leak the secret into the error
  // text (and thus the model's context). Fail with a generic message instead.
  try {
    new URL(req.url);
  } catch {
    throw new CloudFlowError("Invalid Cloud Flow URL", false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (req.auth.type === "oauth") {
    headers.authorization = `Bearer ${req.auth.bearer}`;
  }

  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body ?? {}),
      signal: controller.signal,
    });
    const { text, truncated, totalBytes } = await readBodyCapped(res, req.maxResponseBytes);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      body: tryParseJson(text),
      truncated,
      totalBytes,
    };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    throw new CloudFlowError(
      aborted
        ? `Request aborted after ${req.timeoutMs}ms. Cloud Flow Response action cap is 120s.`
        : `Request failed: ${(err as Error).message}`,
      aborted,
    );
  } finally {
    clearTimeout(timer);
  }
}

function tryParseJson(s: string): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Drain res.body up to `cap` bytes, then abort the stream so the remote can't
 * pin our memory. Response.text() would happily buffer gigabytes; this guard
 * exists so a misconfigured flow returning a stream can't OOM the host during
 * an agent loop.
 */
async function readBodyCapped(
  res: Response,
  cap: number,
): Promise<{ text: string; truncated: boolean; totalBytes: number }> {
  if (!res.body) {
    // No stream (e.g. a stubbed Response in tests) — fall back to text().
    const text = await res.text().catch(() => "");
    return { text, truncated: false, totalBytes: Buffer.byteLength(text) };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        truncated = true;
        const keep = value.byteLength - (total - cap);
        if (keep > 0) chunks.push(value.subarray(0, keep));
        break;
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader already closed — nothing to do.
    }
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  return { text, truncated, totalBytes: total };
}
