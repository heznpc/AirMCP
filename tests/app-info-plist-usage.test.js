import { describe, test, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
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

function readSwiftFiles(dir) {
  let out = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out += readSwiftFiles(full);
    else if (entry.name.endsWith(".swift")) out += `\n// ${full}\n${readFileSync(full, "utf-8")}`;
  }
  return out;
}

const swiftBridgeSource = [join(ROOT, "swift", "Sources", "AirMCPKit"), join(ROOT, "swift", "Sources", "AirMcpBridge")]
  .map(readSwiftFiles)
  .join("\n");

// Each entry maps a TCC-gated Swift framework/API the bridge actually uses to
// the app Info.plist usage-description keys required for the signed .app
// surface. This keeps the guard tied to runtime capability use instead of a
// manually curated key list.
const PRIVACY_REQUIREMENTS = [
  {
    name: "EventKit calendars/reminders",
    uses: /\bEKEventStore\b|import EventKit/,
    keys: ["NSCalendarsFullAccessUsageDescription", "NSRemindersFullAccessUsageDescription"],
  },
  {
    name: "Speech",
    uses: /\bSFSpeechRecognizer\b|import Speech/,
    keys: ["NSSpeechRecognitionUsageDescription"],
  },
  {
    name: "PhotoKit",
    uses: /\bPHPhotoLibrary\b|import Photos/,
    keys: ["NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"],
  },
  {
    name: "Contacts",
    uses: /\bCNContactStore\b|import Contacts/,
    keys: ["NSContactsUsageDescription"],
  },
  {
    name: "CoreLocation",
    uses: /\bCLLocationManager\b|import CoreLocation/,
    keys: ["NSLocationWhenInUseUsageDescription"],
  },
  {
    name: "HealthKit read access",
    uses: /\bHKHealthStore\b|import HealthKit/,
    // AirMCP requests read-only health access (`toShare: []`), so the share/read
    // usage string is required; NSHealthUpdateUsageDescription is only for writes.
    keys: ["NSHealthShareUsageDescription"],
  },
];

const REQUIRED = [
  ...new Set(
    PRIVACY_REQUIREMENTS.flatMap((requirement) => (requirement.uses.test(swiftBridgeSource) ? requirement.keys : [])),
  ),
];

describe("app Info.plist — privacy usage descriptions for TCC-gated tools", () => {
  test("derives at least one required key from Swift bridge privacy APIs", () => {
    expect(REQUIRED.length).toBeGreaterThan(0);
  });

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
