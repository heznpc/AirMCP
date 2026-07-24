import Foundation
import XCTest
@testable import AirMCPApp

final class OnboardingDraftStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        suiteName = "AirMCPOnboardingDraftTests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults?.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
    }

    func testRoundTripRestoresWorkflowAndModuleSelection() {
        let saved = OnboardingDraftState(
            workflowID: "meeting-prep",
            disabledModules: ["mail", "messages"],
            appliedScopeFingerprint: String(repeating: "a", count: 64)
        )
        OnboardingDraftStore.save(saved, defaults: defaults)

        let loaded = OnboardingDraftStore.load(
            defaults: defaults,
            validWorkflowIDs: ["daily-briefing", "meeting-prep"],
            validModuleIDs: ["mail", "messages", "calendar"],
            fallback: OnboardingDraftState(workflowID: "daily-briefing", disabledModules: [])
        )
        XCTAssertEqual(loaded, saved)
    }

    func testMalformedAppliedScopeReceiptIsDiscarded() {
        defaults.set(
            [
                "workflowID": "daily-briefing",
                "disabledModules": ["mail"],
                "appliedScopeFingerprint": "not-a-scope-receipt",
            ],
            forKey: AirMcpConstants.keyOnboardingDraft
        )

        let loaded = OnboardingDraftStore.load(
            defaults: defaults,
            validWorkflowIDs: ["daily-briefing"],
            validModuleIDs: ["mail"],
            fallback: OnboardingDraftState(workflowID: "daily-briefing", disabledModules: [])
        )
        XCTAssertNil(loaded.appliedScopeFingerprint)
    }

    func testScopeFingerprintsAreCanonicalAndSeparateDraftFromRuntime() {
        let first = OnboardingRuntimeScope(
            workflowID: "meeting-prep",
            disabledModules: ["notes", "mail", "notes"]
        )
        let reordered = OnboardingRuntimeScope(
            workflowID: "meeting-prep",
            disabledModules: ["mail", "notes"]
        )
        let otherWorkflow = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: ["mail", "notes"]
        )

        XCTAssertEqual(first, reordered)
        XCTAssertEqual(first.runtimeFingerprint, reordered.runtimeFingerprint)
        XCTAssertEqual(first.runtimeFingerprint, otherWorkflow.runtimeFingerprint)
        XCTAssertNotEqual(first.draftFingerprint, otherWorkflow.draftFingerprint)
    }

    func testDailyBriefingCoreOnlySurfaceCannotClaimReady() {
        let workflowModules: Set<String> = ["calendar", "reminders", "mail", "notes"]
        let scope = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: onboardingModuleIds.subtracting(workflowModules)
        )

        let assessment = scope.assessRuntimeSurface(
            enabledModules: ["calendar", "reminders"],
            unavailableModules: [
                AppRuntimeModuleUnavailable(module: "mail", reason: "module_pack", detail: nil),
                AppRuntimeModuleUnavailable(module: "notes", reason: "module_pack", detail: nil),
            ]
        )

        XCTAssertFalse(assessment.isAcceptable)
        XCTAssertEqual(assessment.missingRequiredModules, ["mail", "notes"])
        XCTAssertEqual(assessment.undiagnosedRequestedModules, [])
        XCTAssertEqual(assessment.unexpectedlyEnabledModules, [])
        XCTAssertEqual(assessment.diagnosedUnavailableModules.map(\.module), ["mail", "notes"])
    }

    func testDiagnosedUnavailableOptionalModuleKeepsExactSurfaceAcceptable() {
        let requested: Set<String> = ["calendar", "reminders", "mail", "notes", "intelligence"]
        let scope = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: onboardingModuleIds.subtracting(requested)
        )

        let assessment = scope.assessRuntimeSurface(
            enabledModules: ["calendar", "reminders", "mail", "notes"],
            unavailableModules: [
                AppRuntimeModuleUnavailable(
                    module: "intelligence",
                    reason: "host_unavailable",
                    detail: "requires a newer host"
                ),
            ]
        )

        XCTAssertTrue(assessment.isAcceptable)
        XCTAssertEqual(assessment.diagnosedUnavailableModules.map(\.module), ["intelligence"])
    }

    func testSelectedModuleMissingWithoutDiagnosisFailsClosed() {
        let requested: Set<String> = ["calendar", "reminders", "mail", "notes", "weather"]
        let scope = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: onboardingModuleIds.subtracting(requested)
        )

        let assessment = scope.assessRuntimeSurface(
            enabledModules: ["calendar", "reminders", "mail", "notes"],
            unavailableModules: []
        )

        XCTAssertFalse(assessment.isAcceptable)
        XCTAssertEqual(assessment.missingRequiredModules, [])
        XCTAssertEqual(assessment.undiagnosedRequestedModules, ["weather"])
    }

    func testDisabledModuleLoadedByRuntimeFailsExactScope() {
        let workflowModules: Set<String> = ["calendar", "reminders", "mail", "notes"]
        let scope = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: onboardingModuleIds.subtracting(workflowModules)
        )

        let assessment = scope.assessRuntimeSurface(
            enabledModules: ["calendar", "reminders", "mail", "notes", "messages"],
            unavailableModules: []
        )

        XCTAssertFalse(assessment.isAcceptable)
        XCTAssertEqual(assessment.unexpectedlyEnabledModules, ["messages"])
    }

    func testInvalidDraftFallsBackAndClearRemovesIt() {
        OnboardingDraftStore.save(
            OnboardingDraftState(workflowID: "removed-workflow", disabledModules: ["mail"]),
            defaults: defaults
        )
        let fallback = OnboardingDraftState(workflowID: "daily-briefing", disabledModules: ["messages"])
        XCTAssertEqual(
            OnboardingDraftStore.load(
                defaults: defaults,
                validWorkflowIDs: ["daily-briefing"],
                validModuleIDs: ["mail", "messages"],
                fallback: fallback
            ),
            fallback
        )

        OnboardingDraftStore.clear(defaults: defaults)
        XCTAssertNil(defaults.object(forKey: AirMcpConstants.keyOnboardingDraft))
    }

    func testFirstSetupUsesWorkflowPresetAsFallback() {
        let fallback = OnboardingDraftStore.fallbackState(
            onboardingCompleted: false,
            configuredDisabledModules: ["mail"],
            defaultWorkflowID: "daily-briefing",
            defaultDisabledModules: ["messages"],
            validModuleIDs: ["mail", "messages"]
        )

        XCTAssertEqual(
            fallback,
            OnboardingDraftState(
                workflowID: "daily-briefing",
                disabledModules: ["messages"]
            )
        )
    }

    func testCompletedSetupReopenPreservesConfiguredModules() {
        let fallback = OnboardingDraftStore.fallbackState(
            onboardingCompleted: true,
            configuredDisabledModules: ["mail", "removed-module"],
            defaultWorkflowID: "daily-briefing",
            defaultDisabledModules: ["messages"],
            validModuleIDs: ["mail", "messages"]
        )

        XCTAssertEqual(
            fallback,
            OnboardingDraftState(
                workflowID: "daily-briefing",
                disabledModules: ["mail"]
            )
        )
    }

    func testModulesOutsideSetupCatalogRemainDisabled() {
        let unmanaged = OnboardingDraftStore.unmanagedDisabledModules(
            onboardingCompleted: true,
            configuredDisabledModules: ["mail", "pages", "health"],
            managedModuleIDs: ["mail", "messages"],
            allModuleIDs: ["mail", "messages", "pages", "health"]
        )

        XCTAssertEqual(unmanaged, ["pages", "health"])
        XCTAssertEqual(Set(["messages"]).union(unmanaged), ["messages", "pages", "health"])
    }

    func testFirstSetupDisablesEveryModuleOutsidePresentedCatalog() {
        let unmanaged = OnboardingDraftStore.unmanagedDisabledModules(
            onboardingCompleted: false,
            configuredDisabledModules: [],
            managedModuleIDs: ["mail", "messages"],
            allModuleIDs: ["mail", "messages", "pages", "health", "spatial_prep"]
        )

        XCTAssertEqual(unmanaged, ["pages", "health", "spatial_prep"])
    }
}
