import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const onboarding = readFileSync(
  new URL("app/Sources/AirMCPApp/Views/OnboardingView.swift", root),
  "utf8",
);
const app = readFileSync(new URL("app/Sources/AirMCPApp/AirMCPApp.swift", root), "utf8");
const menu = readFileSync(
  new URL("app/Sources/AirMCPApp/Views/MenuContent.swift", root),
  "utf8",
);
const en = readFileSync(
  new URL("app/Sources/AirMCPApp/Resources/en.lproj/Localizable.strings", root),
  "utf8",
);
const ko = readFileSync(
  new URL("app/Sources/AirMCPApp/Resources/ko.lproj/Localizable.strings", root),
  "utf8",
);

describe("macOS onboarding layout", () => {
  test("uses one compact size contract for the SwiftUI view and NSWindow", () => {
    expect(onboarding).toContain("static let preferredContentSize = NSSize(width: 640, height: 520)");
    expect(onboarding).toContain("width: Self.preferredContentSize.width");
    expect(app).toContain("window.setContentSize(OnboardingView.preferredContentSize)");
    expect(app).toContain("window.contentMinSize = OnboardingView.preferredContentSize");
    expect(app).toContain("window.contentMaxSize = OnboardingView.preferredContentSize");
    expect(onboarding).not.toContain(".frame(width: 540, height: 540)");
  });

  test("replaces detached dots and welcome spacers with a labeled progress header and value rows", () => {
    const welcome = onboarding.match(
      /private var welcomeStep:[\s\S]*?\/\/ MARK: - Step 2/,
    )?.[0] ?? "";
    expect(onboarding).toContain("ProgressView(value: Double(currentStep + 1)");
    expect(onboarding).toContain('L("onboarding.progress", currentStep + 1, totalSteps)');
    expect(welcome).not.toContain("Spacer()\n");
    expect(welcome.match(/welcomeFeatureRow\(/g)).toHaveLength(4); // declaration + three rows
  });

  test("loads the copied SwiftPM icon from its real bundle location and keeps a fallback", () => {
    expect(onboarding).toContain('Bundle.module.url(forResource: "AppIcon@2x", withExtension: "png")');
    expect(onboarding).not.toContain('subdirectory: "Resources"');
    expect(onboarding).toContain('Image(systemName: "a.square.fill")');
    expect(app).not.toContain('subdirectory: "Resources"');
  });

  test("has a deterministic preview launch switch and localized trust copy", () => {
    expect(menu).toContain('static let envShowOnboarding = "AIRMCP_SHOW_ONBOARDING"');
    expect(app).toContain("AirMcpConstants.envShowOnboarding");
    for (const key of [
      "onboarding.stepWelcome",
      "onboarding.progress",
      "onboarding.welcomeLocalTitle",
      "onboarding.welcomeControlTitle",
      "onboarding.welcomeClientTitle",
    ]) {
      expect(en).toContain(`"${key}"`);
      expect(ko).toContain(`"${key}"`);
    }
    expect(onboarding).not.toContain("onboarding.copyCodexPrompt");
    expect(en).toContain('"onboarding.autoPatch" = "Connect"');
    expect(ko).toContain('"onboarding.autoPatch" = "연결"');
  });

  test("requires explicit, informed consent before enabling the persistent Codex server", () => {
    expect(onboarding).toContain(
      'client.id == "codex" ? L("onboarding.enableInCodex") : L("onboarding.autoPatch")',
    );
    expect(onboarding).toContain('L("onboarding.codexStartupDisclosure")');
    expect(en).toContain('"onboarding.enableInCodex" = "Enable in Codex"');
    expect(en).toContain("Codex will try to connect at every startup");
    expect(en).toContain("may open AirMCP.app when needed");
    expect(ko).toContain('"onboarding.enableInCodex" = "Codex에서 활성화"');
    expect(ko).toContain("Codex는 시작할 때마다 AirMCP 연결을 시도");
    expect(ko).toContain("AirMCP.app을 열 수 있습니다");
  });
});
