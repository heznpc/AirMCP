import XCTest
@testable import AirMCPApp

final class OnboardingGovernedWritePolicyTests: XCTestCase {
    func testSensitiveAndStricterLevelsGateTheReminderCall() {
        for level in [HitlLevel.sensitiveOnly, .allWrites, .all] {
            XCTAssertTrue(
                OnboardingGovernedWritePolicy.allowsReminderExample(
                    remindersEnabled: true,
                    configuredHitlLevel: level,
                    configuredWhitelist: [],
                    runtimePolicy: .stopped
                )
            )
        }
    }

    func testDisabledOrDestructiveOnlyApprovalFailsClosed() {
        for level in [HitlLevel.off, .destructiveOnly] {
            XCTAssertFalse(
                OnboardingGovernedWritePolicy.allowsReminderExample(
                    remindersEnabled: true,
                    configuredHitlLevel: level,
                    configuredWhitelist: [],
                    runtimePolicy: .stopped
                )
            )
        }
    }

    func testReminderModuleAndExactToolApprovalAreBothRequired() {
        XCTAssertFalse(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: false,
                configuredHitlLevel: .sensitiveOnly,
                configuredWhitelist: [],
                runtimePolicy: .stopped
            )
        )
        XCTAssertFalse(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: true,
                configuredHitlLevel: .sensitiveOnly,
                configuredWhitelist: ["create_reminder"],
                runtimePolicy: .stopped
            )
        )
    }

    func testRunningRuntimePolicyOverridesSaferStoredConfig() {
        XCTAssertFalse(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: true,
                configuredHitlLevel: .sensitiveOnly,
                configuredWhitelist: [],
                runtimePolicy: .running(hitlLevel: .off, whitelist: [])
            )
        )
    }

    func testRunningRuntimePolicyOverridesLessSafeStoredConfig() {
        XCTAssertTrue(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: true,
                configuredHitlLevel: .off,
                configuredWhitelist: ["create_reminder"],
                runtimePolicy: .running(hitlLevel: .sensitiveOnly, whitelist: [])
            )
        )
    }

    func testRunningRuntimeExactWhitelistFailsClosed() {
        XCTAssertFalse(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: true,
                configuredHitlLevel: .all,
                configuredWhitelist: [],
                runtimePolicy: .running(
                    hitlLevel: .all,
                    whitelist: ["create_reminder"]
                )
            )
        )
        XCTAssertTrue(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: true,
                configuredHitlLevel: .all,
                configuredWhitelist: ["create_reminder"],
                runtimePolicy: .running(hitlLevel: .all, whitelist: ["search_notes"])
            )
        )
    }

    func testUnknownRuntimePolicyNeverFallsBackToConfig() {
        XCTAssertFalse(
            OnboardingGovernedWritePolicy.allowsReminderExample(
                remindersEnabled: true,
                configuredHitlLevel: .all,
                configuredWhitelist: [],
                runtimePolicy: .unavailable
            )
        )
    }

    func testRuntimeStateDecodesEffectiveHitlContract() throws {
        let json = #"""
        {
          "status": "ok",
          "version": "2.16.0",
          "appOwned": true,
          "pid": 4242,
          "ownerFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "disabledModules": [],
          "scopeFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "enabledModules": ["reminders"],
          "unavailableModules": [],
          "effectiveHitlLevel": "all-writes",
          "effectiveHitlWhitelist": ["search_notes"]
        }
        """#.data(using: .utf8)!

        let state = try JSONDecoder().decode(AppRuntimeState.self, from: json)
        XCTAssertEqual(state.effectiveHitlLevel, .allWrites)
        XCTAssertEqual(state.effectiveHitlWhitelist, ["search_notes"])
    }
}
