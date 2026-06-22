import { describe, test, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The macOS app's Info.plist MUST declare a usage description for every
// privacy-gated (TCC) capability any tool touches. If the declaration is
// MISSING, macOS does not return "permission denied" — it HARD-ABORTS the
// process (SIGABRT / exit 134, "attempted to access privacy-sensitive data
// without a usage description") the instant the API is touched, BEFORE the
// Swift code's graceful `.notAuthorized` path can run.
//
// This is a registration-vs-runtime guard: `transcribe_audio` was a registered,
// shipping tool whose NSSpeechRecognitionUsageDescription was absent repo-wide,
// so it crashed on EVERY surface (confirmed via the on-disk crash report's
// TCC termination block) until the key was added here. This test fails loudly
// if any required privacy declaration is dropped again.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLIST = join(ROOT, "app", "Sources", "AirMCPApp", "Resources", "Info.plist");
const plist = readFileSync(PLIST, "utf-8");

// Each entry: the usage-description key a TCC-gated tool family requires.
const REQUIRED = [
  "NSCalendarsFullAccessUsageDescription",
  "NSRemindersFullAccessUsageDescription",
  "NSSpeechRecognitionUsageDescription",
];

describe("app Info.plist — privacy usage descriptions for TCC-gated tools", () => {
  for (const key of REQUIRED) {
    test(`declares ${key} (missing → TCC 134 abort, not a graceful error)`, () => {
      expect(plist).toContain(`<key>${key}</key>`);
    });
  }

  test("each declaration carries a non-empty explanatory string", () => {
    for (const key of REQUIRED) {
      const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
      expect(m).not.toBeNull();
      expect(m[1].trim().length).toBeGreaterThan(10);
    }
  });
});
