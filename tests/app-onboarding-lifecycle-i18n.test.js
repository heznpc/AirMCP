import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const app = read("app/Sources/AirMCPApp/AirMCPApp.swift");
const menu = read("app/Sources/AirMCPApp/Views/MenuContent.swift");
const onboarding = read("app/Sources/AirMCPApp/Views/OnboardingView.swift");
const serverManager = read("app/Sources/AirMCPApp/ServerManager.swift");
const packageManifest = read("app/Package.swift");
const infoPlist = read("app/Sources/AirMCPApp/Resources/Info.plist");
const english = read("app/Sources/AirMCPApp/Resources/en.lproj/Localizable.strings");

const locales = ["de", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"];
const quickSetupKeys = [
  "menu.getStarted",
  "menu.setupPermissions",
  "menu.settingUp",
  "setup.step",
  "setup.done",
  "setup.failed",
  "setup.permissions",
  "setup.startingServer",
  "setup.copyingConfig",
];
const workflowPrefixes = [
  "workflow.dailyBriefing",
  "workflow.inboxTriage",
  "workflow.meetingPrep",
  "workflow.projectDigest",
  "workflow.focusBlocks",
  "workflow.researchOutput",
];
const moduleIds = [
  "notes",
  "reminders",
  "calendar",
  "contacts",
  "mail",
  "messages",
  "safari",
  "finder",
  "music",
  "photos",
  "tv",
  "podcasts",
  "system",
  "shortcuts",
  "ui",
  "screen",
  "intelligence",
  "memory",
  "audit",
  "weather",
  "location",
  "maps",
  "bluetooth",
  "google",
];

function stringsMap(source) {
  const values = new Map();
  for (const match of source.matchAll(/^"([^"]+)"\s*=\s*"((?:\\.|[^"\\])*)";/gm)) {
    values.set(match[1], match[2]);
  }
  return values;
}

function formatTokens(value) {
  return [...value.matchAll(/%(?:\d+\$)?(?:\.\d+)?[@df]/g)].map((match) => match[0]).sort();
}

describe("macOS onboarding lifecycle", () => {
  test("automatically presents setup once, while keeping manual reopen available", () => {
    expect(menu).toContain('static let keyOnboardingPresented = "onboardingPresented"');
    expect(app).toContain("!onboardingCompleted && !onboardingPresented");
    expect(app).toContain("else if onboardingCompleted");
    expect(app).toContain("UserDefaults.standard.set(true, forKey: AirMcpConstants.keyOnboardingPresented)");
    expect(menu).toContain('Button(L("menu.openSetup"))');
    expect(menu).toContain("onShowOnboarding()");
  });

  test("focuses the existing setup window instead of creating a duplicate", () => {
    expect(app).toContain("if let existingWindow = OnboardingWindowHolder.shared.window");
    expect(app).toContain("existingWindow.makeKeyAndOrderFront(nil)");
    expect(app).toContain('window.title = L("onboarding.windowTitle")');
  });

  test("resumes an explicitly enabled runtime when setup was closed before Finish", () => {
    expect(app).toContain("onboardingCompleted || serverManager.autoStartEnabled");
    expect(app).toContain("serverManager.autoStartIfNeeded()");
  });

  test("accepts only the exact authenticated app-owned runtime as ready", () => {
    expect(onboarding).toContain("ServerManager.authenticatedAppOwnedRuntimeVersion()");
    expect(onboarding).not.toContain("runtimeHealthVersion()");
    expect(serverManager).toContain("version == AirMcpConstants.npmPackageVersion");
    expect(serverManager).toContain("await AppRuntimeClient.probe()");
  });

  test("writes token-bearing client configs and backups owner-only", () => {
    expect(onboarding).toContain("installFileAtomically(originalData, at: backupPath, permissions: 0o600)");
    expect(onboarding).toContain("installFileAtomically(data, at: path, permissions: 0o600)");
    expect(onboarding).toContain(".posixPermissions: NSNumber(value: permissions)");
    expect(onboarding).toContain("if let originalData {");
    expect(onboarding).toContain("try? installFileAtomically(");
  });
});

describe("macOS onboarding localization", () => {
  const en = stringsMap(english);
  const requiredKeys = [...en.keys()].filter(
    (key) =>
      key.startsWith("onboarding.") ||
      workflowPrefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)) ||
      moduleIds.some((id) => key === `module.${id}` || key === `module.${id}.desc`) ||
      quickSetupKeys.includes(key) ||
      key === "menu.openSetup",
  );

  test("uses explicit English fallback for partial locale bundles", () => {
    expect(menu).toContain('Bundle.module.path(forResource: "en", ofType: "lproj")');
    expect(menu).toContain("englishBundle.localizedString(forKey: key");
  });

  test("allows the localized SwiftPM resource bundle to follow the host language", () => {
    expect(infoPlist).toContain("<key>CFBundleAllowMixedLocalizations</key>");
    expect(infoPlist).toContain("<true/>");
    expect(infoPlist).toContain("<key>CFBundleLocalizations</key>");
    for (const locale of ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"]) {
      expect(infoPlist).toContain(`<string>${locale}</string>`);
    }
  });

  test.each(locales)("%s contains the complete setup surface", (locale) => {
    const source = read(`app/Sources/AirMCPApp/Resources/${locale}.lproj/Localizable.strings`);
    const translated = stringsMap(source);
    expect([...translated.keys()].filter((key) => requiredKeys.includes(key))).toHaveLength(requiredKeys.length);

    for (const key of requiredKeys) {
      expect(translated.has(key)).toBe(true);
      expect(translated.get(key)?.trim()).not.toBe("");
      expect(formatTokens(translated.get(key) ?? "")).toEqual(formatTokens(en.get(key) ?? ""));
    }
  });

  test.each(locales)("%s is packaged as a SwiftPM localization", (locale) => {
    expect(packageManifest).toContain(`.process("Resources/${locale}.lproj")`);
  });
});
