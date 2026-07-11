#!/usr/bin/env node

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_LIKE = /^(?:[A-Z0-9]{10}|[0-9]{6,}|[0-9A-Fa-f]{16,})$/;
const PRIVATE_PATH_SEGMENT = /^(?:Users|home|tmp|private|var|folders)$/i;

function publishableSegment(value) {
  const raw = String(value ?? "");
  if (!raw || raw.includes("@") || UUID.test(raw) || ACCOUNT_LIKE.test(raw) || PRIVATE_PATH_SEGMENT.test(raw)) {
    return "redacted";
  }
  return raw.replace(/[^A-Za-z0-9_.+-]/g, "_").slice(0, 120) || "redacted";
}

function publishablePath(value) {
  const segments = String(value ?? "").split("/").filter(Boolean);
  const appIndex = segments.findIndex((segment) => segment === "AirMCP.app");
  if (appIndex < 0) return "artifact";
  return segments.slice(appIndex, appIndex + 12).map(publishableSegment).join("/") || "artifact";
}

function publishableCode(value) {
  const raw = String(value ?? "");
  if (!raw || raw.includes("@") || UUID.test(raw) || ACCOUNT_LIKE.test(raw)) return "unknown";
  return raw.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
}

/** Print only non-identifying notary issue coordinates. Never print the job,
 * team, certificate subject, account email, submission id, raw messages, or
 * path prefixes outside the submitted AirMCP.app bundle. */
export function sanitizedNotaryIssues(document) {
  const issues = Array.isArray(document?.issues) ? document.issues : [];
  return issues.slice(0, 50).map((issue) => {
    const severity = /^(error|warning)$/i.test(String(issue?.severity ?? ""))
      ? String(issue.severity).toLowerCase()
      : "issue";
    const code = publishableCode(issue?.code);
    const path = publishablePath(issue?.path);
    return `notarization ${severity}: code=${code} path=${path}`;
  });
}

if (process.argv[1]?.endsWith("sanitize-notary-log.mjs")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    try {
      const lines = sanitizedNotaryIssues(JSON.parse(input));
      if (lines.length === 0) console.error("notarization failed without publishable issue coordinates");
      else for (const line of lines) console.error(line);
    } catch {
      console.error("notarization failed and the private notary log could not be summarized");
    }
  });
}
