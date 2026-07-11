import Foundation
import XCTest
@testable import AirMCPApp

final class OnboardingAutoStartConsentPolicyTests: XCTestCase {
    private func receipt(generation: UInt64) -> ServerManager.OnboardingRuntimeReceipt {
        ServerManager.OnboardingRuntimeReceipt(
            generation: generation,
            version: "2.16.0",
            draftFingerprint: String(repeating: "a", count: 64),
            runtimeFingerprint: String(repeating: "b", count: 64),
            tokenFingerprint: String(repeating: "c", count: 64),
            enabledModules: ["audit"],
            unavailableModules: []
        )
    }

    func testReadyActivationRecordsNewOptIn() {
        XCTAssertTrue(
            OnboardingAutoStartConsentPolicy.resolvedValue(
                previouslyEnabled: false,
                activationReady: true
            )
        )
    }

    func testFailedActivationRestoresDisabledPreference() {
        XCTAssertFalse(
            OnboardingAutoStartConsentPolicy.resolvedValue(
                previouslyEnabled: false,
                activationReady: false
            )
        )
    }

    func testFailedActivationNeverDisablesExistingOptIn() {
        XCTAssertTrue(
            OnboardingAutoStartConsentPolicy.resolvedValue(
                previouslyEnabled: true,
                activationReady: false
            )
        )
    }

    @MainActor
    func testReadyReceiptThatImmediatelyStopsIsRecoveredBeforeUse() async throws {
        let recoveredReceipt = receipt(generation: 2)
        let exitedRuntime = Process()
        exitedRuntime.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        try exitedRuntime.run()
        exitedRuntime.waitUntilExit()
        XCTAssertFalse(exitedRuntime.isRunning)

        var autoStartEnabled = false
        var runtimeProcess: Process? = exitedRuntime
        let managerStatusStillSaysRunning = true
        var events: [String] = []

        let result = await OnboardingRuntimeReadyBarrier.stabilize(
            commitAutoStart: {
                events.append("commit-auto-start")
                autoStartEnabled = true
            },
            requestAutoStart: {
                events.append("auto-start-if-needed")
                // Reproduce the lifecycle race: the child is already gone,
                // but ServerManager has not processed its termination callback.
                if autoStartEnabled && !managerStatusStillSaysRunning {
                    XCTFail("The stale status unexpectedly allowed lightweight recovery")
                }
            },
            scopeIsCurrent: { true },
            validate: {
                events.append("validate")
                return runtimeProcess?.isRunning == true
                    ? .ready(self.receipt(generation: 1))
                    : .failed("runtime stopped after ready")
            },
            recover: {
                events.append("recover-activation")
                let replacement = Process()
                replacement.executableURL = URL(fileURLWithPath: "/bin/sleep")
                replacement.arguments = ["30"]
                do {
                    try replacement.run()
                    runtimeProcess = replacement
                    return .ready(recoveredReceipt)
                } catch {
                    return .failed("replacement runtime could not start")
                }
            }
        )

        let replacementWasRunning = runtimeProcess?.isRunning == true
        XCTAssertTrue(autoStartEnabled)
        XCTAssertTrue(replacementWasRunning)
        XCTAssertEqual(
            events,
            ["commit-auto-start", "auto-start-if-needed", "validate", "recover-activation"]
        )
        if let runtimeProcess, runtimeProcess.isRunning {
            await ServerManager.terminateOwnedProcess(runtimeProcess)
        }
        guard case .ready(let receipt) = result else {
            return XCTFail("The stopped runtime was not recovered to a fresh ready receipt")
        }
        XCTAssertEqual(receipt, recoveredReceipt)
    }

    @MainActor
    func testScopeChangeAfterStaleReceiptPreventsRecovery() async {
        var recovered = false
        var scopeIsCurrent = true

        let result = await OnboardingRuntimeReadyBarrier.stabilize(
            commitAutoStart: {},
            requestAutoStart: {},
            scopeIsCurrent: { scopeIsCurrent },
            validate: {
                scopeIsCurrent = false
                return .failed("runtime stopped after ready")
            },
            recover: {
                recovered = true
                return .ready(self.receipt(generation: 2))
            }
        )

        XCTAssertNil(result)
        XCTAssertFalse(recovered)
    }

    @MainActor
    func testFailedRecoveryRestoresFreshUsersPreviousPreference() async {
        var temporaryAutoStartEnabled = false
        var activationReady = false

        let result = await OnboardingRuntimeReadyBarrier.stabilize(
            commitAutoStart: { temporaryAutoStartEnabled = true },
            requestAutoStart: {},
            scopeIsCurrent: { true },
            validate: { .failed("runtime stopped after ready") },
            recover: { .failed("runtime restart failed") }
        )
        if case .ready = result { activationReady = true }

        XCTAssertTrue(temporaryAutoStartEnabled)
        XCTAssertFalse(activationReady)
        XCTAssertFalse(
            OnboardingAutoStartConsentPolicy.resolvedValue(
                previouslyEnabled: false,
                activationReady: activationReady
            )
        )
    }

    @MainActor
    func testManualRuntimeAfterInitialReadyDoesNotCommitFreshUserOptIn() async {
        var temporaryAutoStartEnabled = false
        var activationReady = false
        var recoveryAttempted = false

        let result = await OnboardingRuntimeReadyBarrier.stabilize(
            commitAutoStart: { temporaryAutoStartEnabled = true },
            requestAutoStart: {},
            scopeIsCurrent: { true },
            validate: { .manualRuntime(version: "2.16.0") },
            recover: {
                recoveryAttempted = true
                return .failed("manual runtimes must not be replaced")
            }
        )
        if case .ready = result { activationReady = true }

        XCTAssertTrue(temporaryAutoStartEnabled)
        XCTAssertFalse(recoveryAttempted)
        XCTAssertFalse(activationReady)
        XCTAssertFalse(
            OnboardingAutoStartConsentPolicy.resolvedValue(
                previouslyEnabled: false,
                activationReady: activationReady
            )
        )
    }
}
