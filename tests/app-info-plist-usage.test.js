import { describe, test, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The macOS app's Info.plist MUST declare a usage description for every
// privacy-gated (TCC) capability any tool touches. Missing declarations have
// API-specific failure modes: Speech hard-aborted (SIGABRT / exit 134) when it
// called requestAuthorization, while PhotoKit / Contacts degraded gracefully but
// could not be granted on the .app surface.
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
// Cross-referenced against the TCC-gated frameworks the Swift bridge actually
// uses (EventKit, Speech, PhotoKit, Contacts, CoreLocation). Speech was the only one that
// HARD-CRASHED without its key (it calls requestAuthorization); PhotoKit /
// Contacts degrade gracefully (empty / "Access Denied") but still cannot be
// granted on the .app surface without a declaration, so the tools stay
// non-functional there until these are present. (Location/CLLocationManager is
// included because get_current_location prompts through CoreLocation.)
const REQUIRED = [
  "NSCalendarsFullAccessUsageDescription",
  "NSRemindersFullAccessUsageDescription",
  "NSSpeechRecognitionUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSContactsUsageDescription",
  "NSLocationWhenInUseUsageDescription",
];

describe("app Info.plist — privacy usage descriptions for TCC-gated tools", () => {
  for (const key of REQUIRED) {
    test(`declares ${key} (missing → TCC crash or ungrantable app capability)`, () => {
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
