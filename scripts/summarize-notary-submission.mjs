#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Return only fixed, non-identifying diagnostics. Raw notary responses can
// contain account names, submission IDs, certificate subjects and credentials.
export function summarizeNotarySubmission(stdout, stderr, exitCode) {
  let response;
  try { response = JSON.parse(stdout); } catch { /* Transport failures may not return JSON. */ }
  if (exitCode === 0 && response?.status === "Accepted") {
    return "notarization accepted";
  }
  if (response?.status === "Invalid" || response?.status === "Rejected") {
    return "notarization rejected the artifact; inspect the sanitized issue coordinates";
  }
  if (/^[0-9a-f-]{36}$/i.test(String(response?.id ?? ""))) {
    return "notarization submission exists but acceptance was not confirmed; check its status before resubmitting";
  }
  const text = `${stdout}\n${stderr}`;
  if (/agreement|license.{0,30}(accept|pending)/i.test(text)) {
    return "notarization account agreement requires attention in the Apple Developer account";
  }
  if (/HTTP status code:\s*401|invalid credentials|authentication failed|unauthorized/i.test(text)) {
    return "notarization authentication failed; validate the configured app-specific password or API key";
  }
  if (/HTTP status code:\s*403|forbidden|not.{0,20}(member|authorized)|permission denied/i.test(text)) {
    return "notarization authorization failed; check team membership and account permissions";
  }
  if (/NSURLErrorDomain|timed? out|timeout|could not resolve|network|connection|SSL|TLS/i.test(text)) {
    return "notarization transport failed; check Apple service connectivity before changing credentials";
  }
  return "notarization submission was not confirmed; the available response does not establish an account or artifact failure";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stdoutFile, stderrFile, exitCode] = process.argv.slice(2);
  try {
    console.error(summarizeNotarySubmission(readFileSync(stdoutFile, "utf8"), readFileSync(stderrFile, "utf8"), Number(exitCode)));
  } catch {
    console.error("notarization response could not be summarized; private diagnostic output was suppressed");
  }
}
