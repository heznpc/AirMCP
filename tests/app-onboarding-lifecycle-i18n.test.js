import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const app = read("app/Sources/AirMCPApp/AirMCPApp.swift");
const menu = read("app/Sources/AirMCPApp/Views/MenuContent.swift");
const onboarding = read("app/Sources/AirMCPApp/Views/OnboardingView.swift");
const serverManager = read("app/Sources/AirMCPApp/ServerManager.swift");
const appIntents = read("app/Sources/AirMCPApp/AppIntents.swift");
const appRuntimeToken = read("app/Sources/AirMCPApp/AppRuntimeToken.swift");
const setupManager = read("app/Sources/AirMCPApp/SetupManager.swift");
const runtimeConsent = read("app/Sources/AirMCPApp/RuntimeStartConsentPolicy.swift");
const configManager = read("app/Sources/AirMCPApp/ConfigManager.swift");
const draftStore = read("app/Sources/AirMCPApp/OnboardingDraftStore.swift");
const runtimeScope = read("app/Sources/AirMCPApp/OnboardingRuntimeScope.swift");
const packageManifest = read("app/Package.swift");
const infoPlist = read("app/Sources/AirMCPApp/Resources/Info.plist");
const english = read("app/Sources/AirMCPApp/Resources/en.lproj/Localizable.strings");
const toolManifest = JSON.parse(read("docs/tool-manifest.json"));

const locales = ["de", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"];
const allLocales = ["en", ...locales];
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
  "workflow.todayOverview",
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

function formatArguments(value) {
  let nextImplicitPosition = 1;
  return [...value.matchAll(/%(?:(\d+)\$)?(\.\d+)?([@df])/g)]
    .map((match) => ({
      position: match[1] ? Number(match[1]) : nextImplicitPosition++,
      conversion: `${match[2] ?? ""}${match[3]}`,
    }))
    .sort((left, right) =>
      left.position === right.position
        ? left.conversion.localeCompare(right.conversion)
        : left.position - right.position,
    );
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

  test("persists the current step until setup is completed", () => {
    expect(menu).toContain('static let keyOnboardingStep = "onboardingCurrentStep"');
    expect(onboarding).toContain("defaults.integer(forKey: AirMcpConstants.keyOnboardingStep)");
    expect(onboarding).toContain("UserDefaults.standard.set(currentStep, forKey: AirMcpConstants.keyOnboardingStep)");
    expect(onboarding).toContain("UserDefaults.standard.removeObject(forKey: AirMcpConstants.keyOnboardingStep)");
  });

  test("restores the workflow/module draft and clears it only after a successful finish", () => {
    expect(menu).toContain('static let keyOnboardingDraft = "onboardingDraft"');
    expect(onboarding).toContain("OnboardingDraftStore.load(");
    expect(onboarding).toContain("OnboardingDraftStore.save(");
    expect(onboarding).toContain("OnboardingDraftStore.clear()");
    expect(onboarding.indexOf("configManager.isOnboardingRuntimeScopePersisted(scope)")).toBeLessThan(
      onboarding.indexOf("OnboardingDraftStore.clear()"),
    );
    expect(onboarding).toContain('L("onboarding.saveFailed")');
    expect(onboarding).toMatch(/let draft = onboardingCompleted\s*\? fallback/);
    expect(onboarding).toContain("configuredDisabledModules: configManager.disabledModules");
    expect(onboarding).toContain(".union(unmanagedDisabledModules)");
  });

  test("serializes client configuration consent actions", () => {
    expect(onboarding).toContain("@State private var patchingClients: Set<String> = []");
    expect(onboarding).toContain("guard patchingClients.isEmpty,");
    expect(onboarding).toContain("|| !patchingClients.isEmpty");
    expect(onboarding).toContain(".disabled(firstRunChecking || !patchingClients.isEmpty)");
    expect(onboarding).toContain("guard !firstRunChecking, patchingClients.isEmpty else { return }");
  });

  test("offers one governed reminder write after the read-only first success", () => {
    const governedWrite = onboarding.match(
      /private var governedWriteActions: some View \{([\s\S]*?)\n    \}\n\n    \/\/\/ Probe the port/,
    )?.[1];
    const governedPolicyProbe = onboarding.match(
      /private func governedReminderCopyAllowed\(for scope: OnboardingRuntimeScope\) async -> Bool \{([\s\S]*?)\n    \}\n\n    \/\/\/ Copying remains observational/,
    )?.[1];
    const governedCopy = onboarding.match(
      /private func copyGovernedReminderPromptIfAllowed\(\) async \{([\s\S]*?)\n    \}\n\n    @ViewBuilder/,
    )?.[1];

    expect(governedWrite).toBeDefined();
    expect(governedPolicyProbe).toBeDefined();
    expect(governedCopy).toBeDefined();
    expect(onboarding.indexOf("firstSuccessActions")).toBeLessThan(
      onboarding.indexOf("governedWriteActions"),
    );
    expect(onboarding).toContain('onboardingWorkflows.first(where: { $0.id == "today-overview" })');
    expect(onboarding).toContain('preconditionFailure("The generated onboarding catalog must contain today-overview.")');
    expect(onboarding).toContain("Label(firstSuccessWorkflow.title");
    expect(onboarding).toContain("Text(firstSuccessWorkflow.prompt)");
    expect(onboarding).toContain("Label(firstSuccessWorkflow.accessSummary");
    expect(onboarding).toContain("AirMcpConstants.copyToClipboard(firstSuccessWorkflow.prompt)");
    expect(onboarding).toContain(".disabled(!firstSuccessModulesEnabled)");
    expect(onboarding).toContain('L("onboarding.readSuccessNeedsModules")');
    expect(onboarding).not.toContain("AirMcpConstants.copyToClipboard(selectedWorkflow.prompt)");
    expect(onboarding).toMatch(
      /let ready = firstSuccessModulesEnabled\s*\? L\("onboarding\.firstRunReadyDesc", receipt\.version, firstSuccessWorkflow\.title\)\s*:\s*L\("onboarding\.firstRunSelectedScopeReadyDesc", receipt\.version, selectedWorkflow\.title\)/,
    );
    expect(onboarding).toContain('L("onboarding.governedWritePrompt")');
    expect(governedWrite).toContain("Task { await copyGovernedReminderPromptIfAllowed() }");
    expect(governedWrite).toContain(".disabled(!governedReminderAvailable)");
    expect(governedWrite).toContain("openWindow(id: AirMcpConstants.trustCenterWindowID)");
    expect(governedWrite).not.toContain("startFirstRunRuntime()");
    expect(governedWrite).not.toContain("activateOnboardingRuntime(");
    expect(governedWrite).not.toContain("autoStartEnabled");
    expect(onboarding).toContain("case .sensitiveOnly, .allWrites, .all: true");
    expect(onboarding).toContain('private static let reminderTool = "create_reminder"');
    expect(onboarding).toContain("guard !whitelist.contains(reminderTool) else { return false }");
    expect(onboarding).toContain("OnboardingGovernedWritePolicy.allowsReminderExample(");
    expect(onboarding).toContain("case .running(let hitlLevel, let whitelist):");
    expect(onboarding).toContain("AppRuntimeClient.runtimeState(token: runtimeToken)");
    expect(onboarding).toContain("state.effectiveHitlLevel");
    expect(onboarding).toContain("state.effectiveHitlWhitelist");
    expect(governedPolicyProbe).toContain("let probe = await ServerManager.probeAppOwnedRuntime()");
    expect(governedPolicyProbe).toContain("guard currentRuntimeScope == scope else { return false }");
    expect(governedPolicyProbe).toContain("ServerManager.runtimeIsConfirmedUnavailable(probe)");
    expect(governedPolicyProbe).toContain("runtimePolicy: .stopped");
    expect(governedPolicyProbe).toContain("guard case .ready(let version, appOwned: true) = probe");
    expect(governedPolicyProbe).toContain("AppRuntimeToken.loadExisting()");
    expect(governedPolicyProbe).toContain("expectedVersion: version");
    expect(governedPolicyProbe).not.toContain("switch serverManager.status");
    expect(governedCopy).toContain("await governedReminderCopyAllowed(for: scope)");
    expect(governedCopy).toContain("currentRuntimeScope == scope");
    expect(governedCopy).toContain("AirMcpConstants.copyToClipboard(governedReminderPrompt)");
    const governedPath = `${governedPolicyProbe}\n${governedCopy}`;
    expect(governedPath).not.toContain("AppRuntimeToken.ensure()");
    expect(governedPath).not.toContain("startFirstRunRuntime()");
    expect(governedPath).not.toContain("activateOnboardingRuntime(");
    expect(governedPath).not.toContain("patchConfig(");
    expect(governedPath).not.toContain("patchCodexConfig(");
    expect(onboarding).toContain('L("onboarding.governedWriteNeedsApproval")');

    const createReminder = toolManifest.tools.find((tool) => tool.name === "create_reminder");
    expect(createReminder?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      sensitiveHint: true,
    });

    const en = stringsMap(english);
    expect(en.get("onboarding.governedWritePrompt")).toContain("create_reminder exactly once");
    expect(en.get("onboarding.governedWritePrompt")).toContain(
      "If approval is denied or unavailable, stop without making changes.",
    );
    expect(en.get("onboarding.governedWriteCopyDisclosure")).toContain(
      "Copying does not run this prompt or grant approval.",
    );
  });

  test("labels no-consent completion as Finish Later until the runtime is ready", () => {
    expect(onboarding).toContain(
      'Button(firstRunReady ? L("onboarding.finishSetup") : L("onboarding.finishLater"))',
    );
    expect(onboarding).toMatch(
      /Button\(firstRunReady \? L\("onboarding\.finishSetup"\) : L\("onboarding\.finishLater"\)\) \{\s*Task \{ await saveAndComplete\(\) \}/,
    );
  });

  test("starts the runtime only after the explicit final-step action", () => {
    const readinessCheck = onboarding.match(/private func checkFirstRunReadiness\(\) async \{([\s\S]*?)\n    \}/)?.[1];
    const explicitStart = onboarding.match(/private func startFirstRunRuntime\(\) async \{([\s\S]*?)\n    \}/)?.[1];
    const listTools = appIntents.match(
      /static func listTools\(\) async throws -> \[String\] \{([\s\S]*?)\n    \}\n\n\}/,
    )?.[1];

    expect(readinessCheck).toBeDefined();
    expect(readinessCheck).not.toContain("AppRuntimeToken.ensure()");
    expect(readinessCheck).not.toContain("startServer()");
    expect(readinessCheck).not.toContain("autoStartEnabled = true");
    expect(appRuntimeToken).toContain("static func loadExisting() throws -> String?");
    expect(listTools).toContain("AppRuntimeToken.loadExisting()");
    expect(listTools).not.toContain("AppRuntimeToken.ensure()");
    expect(explicitStart).toContain("AppRuntimeToken.ensure()");
    expect(explicitStart).toContain("let previousAutoStartEnabled = serverManager.autoStartEnabled");
    expect(explicitStart).toContain("defer {");
    expect(explicitStart).toContain("previouslyEnabled: previousAutoStartEnabled");
    expect(explicitStart).toContain("activationReady: activationReady");
    expect(explicitStart).toContain("case .ready:");
    expect(explicitStart).toContain("OnboardingRuntimeReadyBarrier.stabilize(");
    expect(explicitStart).toContain("commitAutoStart:");
    expect(explicitStart).toContain("activationReady = true");
    expect(explicitStart).toContain("serverManager.autoStartIfNeeded()");
    expect(explicitStart).toContain("serverManager.validateOnboardingRuntime(");
    expect(explicitStart).toContain("serverManager.autoStartEnabled = true");
    expect(explicitStart).toContain("serverManager.activateOnboardingRuntime(");
    expect(explicitStart.indexOf("let previousAutoStartEnabled")).toBeLessThan(
      explicitStart.indexOf("AppRuntimeToken.ensure()"),
    );
    expect(explicitStart.indexOf("serverManager.activateOnboardingRuntime(")).toBeLessThan(
      explicitStart.indexOf("activationReady = true"),
    );
    expect(explicitStart.indexOf("serverManager.autoStartEnabled = true")).toBeLessThan(
      explicitStart.indexOf("serverManager.validateOnboardingRuntime("),
    );
    expect(explicitStart.indexOf("serverManager.validateOnboardingRuntime(")).toBeLessThan(
      explicitStart.indexOf("activationReady = true"),
    );
    expect(onboarding).toContain(".disabled(!firstRunReady || firstRunChecking || !patchingClients.isEmpty)");
    expect(onboarding).not.toContain(".disabled(!firstRunReady)");
    expect(app).toContain("onComplete: {}");
  });

  test("requests approval notifications only from explicit runtime actions", () => {
    const passiveSetup = app.match(/private func setupHitl\(\)[\s\S]*?\n    }/)?.[0] ?? "";
    expect(passiveSetup).not.toContain("requestNotificationPermission()");
    expect(runtimeConsent).toContain("userInitiated && hitlLevel != .off");
    expect(onboarding).toContain("RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(");
    expect(onboarding).toContain("HitlManager.requestNotificationPermission()");
    expect(menu).toContain("requestApprovalNotificationsForExplicitRuntimeStart()");
    expect(setupManager).toContain("RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(");
  });

  test("Quick Setup fails closed when runtime readiness never succeeds", () => {
    expect(setupManager).toContain("guard Self.runtimeReadyForConfiguration(serverManager.status) else");
    expect(setupManager).toMatch(/guard Self\.runtimeReadyForConfiguration[\s\S]*?state = \.failed[\s\S]*?return/);
    expect(setupManager.indexOf("guard Self.runtimeReadyForConfiguration")).toBeLessThan(
      setupManager.indexOf("AirMcpConstants.copyToClipboard"),
    );
  });

  test("accepts only the exact authenticated app-owned runtime as ready", () => {
    expect(onboarding).toContain("serverManager.validateOnboardingRuntime(");
    expect(onboarding).not.toContain("runtimeHealthVersion()");
    expect(serverManager).toContain("expectedVersion: String = AirMcpConstants.npmPackageVersion");
    expect(serverManager).toContain("version == expectedVersion");
    expect(serverManager).toContain("await AppRuntimeClient.probe()");
    expect(appIntents).toContain("static func runtimeState() async throws -> AppRuntimeState");
    expect(appIntents).toContain("static func runtimeState(token: String) async throws -> AppRuntimeState");
    expect(appIntents).toContain("static func runtimeStateWhenReady(");
    expect(appIntents).toContain("let effectiveHitlLevel: HitlLevel");
    expect(appIntents).toContain("let effectiveHitlWhitelist: [String]");
    expect(appIntents).toContain("catch AppIntentMCPTransportError.httpStatus(let status, _) where status == 503");
    expect(appIntents).toContain("clock.now.duration(to: deadline)");
    expect(appIntents).toContain("requestTimeout: max(0.000_001, min(2, timeInterval(for: remaining)))");
    expect(serverManager).toContain("timeout: .seconds(Self.appOwnedReadinessTimeoutSeconds)");
    expect(serverManager).toContain("activatedState.scopeFingerprint == scope.runtimeFingerprint");
    expect(serverManager).toContain("configManager.isOnboardingRuntimeScopePersisted(scope)");
  });

  test("binds client patching to a persisted scope and runtime generation", () => {
    const patchStart = onboarding.indexOf("private func patchClient(");
    const patchEnd = onboarding.indexOf("/// Readiness checks are observational", patchStart);
    const patchSource = onboarding.slice(patchStart, patchEnd);

    expect(draftStore).toContain("var appliedScopeFingerprint: String?");
    expect(onboarding).toContain("authorizedReceipt.draftFingerprint == scope.draftFingerprint");
    expect(onboarding).toContain("configManager.isOnboardingRuntimeScopePersisted(scope)");
    expect(onboarding).toContain("scopeSelectionDidChange()");
    expect(onboarding).toContain("serverManager.noteOnboardingScopeChanged()");
    expect(serverManager).toContain("private var onboardingScopeRevision: UInt64 = 0");
    expect(serverManager).toContain("capturedRevision == onboardingScopeRevision");
    expect(patchSource.match(/AppRuntimeToken\.loadExisting\(\)/g)).toHaveLength(1);
    expect(patchSource).not.toContain("AppRuntimeToken.ensure()");
    expect(patchSource).toContain("runtimeToken: runtimeToken");
    expect(patchSource).toContain("Self.patchConfig(at: client.configPath, token: runtimeToken)");
    expect(patchSource).toContain("Self.patchCodexConfig(token: runtimeToken)");
    expect(patchSource.indexOf("clientPatchAuthorizationIsCurrent(")).toBeLessThan(
      patchSource.indexOf("let success = await Task.detached"),
    );
    expect(onboarding).toContain("runtimeReceipt == receipt");
    expect(onboarding).toContain("AppRuntimeToken.matchesExisting(runtimeToken)");
  });

  test("runtime receipts prove the effective module surface and fail closed on omissions", () => {
    expect(appIntents).toContain("let enabledModules: [String]");
    expect(appIntents).toContain("let unavailableModules: [AppRuntimeModuleUnavailable]");
    expect(serverManager).toContain("surfaceAssessment?.isAcceptable == true");
    expect(serverManager).toContain("enabledModules: activatedState.enabledModules.sorted()");
    expect(serverManager).toContain("unavailableModules: surfaceAssessment?.diagnosedUnavailableModules ?? []");
    expect(runtimeScope).toContain("missingRequiredModules: Set(requiredModules).subtracting(enabled).sorted()");
    expect(runtimeScope).toContain("undiagnosedRequestedModules:");
    expect(runtimeScope).toContain("unexpectedlyEnabledModules:");
    expect(runtimeScope).toContain("&& unexpectedlyEnabledModules.isEmpty");
  });

  test("persists and read-back verifies Setup scope before runtime launch", () => {
    expect(configManager).toContain("beginOnboardingRuntimeScopeTransaction(");
    expect(configManager).toContain("isOnboardingRuntimeScopePersisted(scope)");
    expect(configManager).toContain("rollbackOnboardingRuntimeScope(");
    expect(serverManager.indexOf("beginOnboardingRuntimeScopeTransaction(scope)")).toBeLessThan(
      serverManager.indexOf("startServerForOnboardingActivation()"),
    );
    expect(serverManager.indexOf("if let manualRuntimeVersion {")).toBeLessThan(
      serverManager.indexOf("guard configManager.rollbackOnboardingRuntimeScope(transaction)"),
    );
  });

  test("Finish never starts a first runtime but blocks or replaces mismatched live runtimes", () => {
    expect(onboarding).toContain("Finishing first-run Setup is not runtime consent");
    expect(onboarding).toContain("case .ready(_, appOwned: false):");
    expect(onboarding).toContain('completionError = L("onboarding.firstRunManualRuntime")');
    expect(onboarding).toContain("if !runtimeMatches");
    expect(onboarding).toContain("ServerManager.authenticatedOwnedRuntimeIdentity(");
    expect(onboarding).toContain("serverManager.activateOnboardingRuntime(");
    expect(onboarding).toContain("// Final completion barrier.");
    expect(
      onboarding.indexOf("case .ready(let finalReceipt) = await serverManager.validateOnboardingRuntime("),
    ).toBeLessThan(
      onboarding.indexOf("UserDefaults.standard.set(true, forKey: AirMcpConstants.keyOnboardingCompleted)"),
    );
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

describe("Trust Center and runtime-diagnostic localization", () => {
  const en = stringsMap(english);
  const trustKeys = [...en.keys()].filter((key) => key.startsWith("trust.")).sort();
  const runtimeDiagnosticKeys = [
    "server.runtimeVersionConflict",
    "server.runtimePortOwnerConflict",
    "server.runtimePortOccupied",
  ];

  test.each(allLocales)("%s contains the complete Trust Center surface", (locale) => {
    const source = read(`app/Sources/AirMCPApp/Resources/${locale}.lproj/Localizable.strings`);
    const translated = stringsMap(source);
    const translatedTrustKeys = [...translated.keys()].filter((key) => key.startsWith("trust.")).sort();

    expect(translatedTrustKeys).toEqual(trustKeys);
    for (const key of trustKeys) {
      expect(translated.get(key)?.trim()).not.toBe("");
      expect(formatArguments(translated.get(key) ?? "")).toEqual(formatArguments(en.get(key) ?? ""));
    }
  });

  test.each(allLocales)("%s contains localized runtime conflict diagnostics", (locale) => {
    const source = read(`app/Sources/AirMCPApp/Resources/${locale}.lproj/Localizable.strings`);
    const translated = stringsMap(source);

    for (const key of runtimeDiagnosticKeys) {
      expect(translated.has(key)).toBe(true);
      expect(translated.get(key)?.trim()).not.toBe("");
      expect(formatArguments(translated.get(key) ?? "")).toEqual(formatArguments(en.get(key) ?? ""));
    }
  });

  test.each(allLocales)("%s localizes the Trust Center supporting controls", (locale) => {
    const source = read(`app/Sources/AirMCPApp/Resources/${locale}.lproj/Localizable.strings`);
    const translated = stringsMap(source);
    for (const key of [
      "menu.trustCenter",
      "server.running",
      "server.stopped",
      "server.checking",
      "hitl.approve",
      "hitl.deny",
    ]) {
      expect(translated.get(key)?.trim()).not.toBe("");
    }
  });
});
