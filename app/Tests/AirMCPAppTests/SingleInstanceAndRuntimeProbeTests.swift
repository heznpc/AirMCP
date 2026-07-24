import Darwin
import Foundation
import XCTest
@testable import AirMCPApp

final class SingleInstanceAndRuntimeProbeTests: XCTestCase {
    func testRuntimeOperationGenerationRejectsStaleWork() {
        var gate = RuntimeOperationGate()
        let startGeneration = gate.advance()
        XCTAssertTrue(gate.accepts(startGeneration))

        let stopGeneration = gate.advance()
        XCTAssertFalse(gate.accepts(startGeneration))
        XCTAssertTrue(gate.accepts(stopGeneration))
    }

    func testReadinessUsesABoundedWallClockBudget() {
        XCTAssertGreaterThan(ServerManager.appOwnedReadinessTimeoutSeconds, 0)
        XCTAssertLessThanOrEqual(ServerManager.appOwnedReadinessTimeoutSeconds, 15)
    }

    func testScheduledRestartRequiresCurrentGenerationAndAutoStart() {
        XCTAssertTrue(
            ServerManager.shouldPerformScheduledRestart(
                capturedGeneration: 4,
                currentGeneration: 4,
                autoStartEnabled: true,
                stopInProgress: false
            )
        )
        XCTAssertFalse(
            ServerManager.shouldPerformScheduledRestart(
                capturedGeneration: 4,
                currentGeneration: 5,
                autoStartEnabled: true,
                stopInProgress: false
            )
        )
        XCTAssertFalse(
            ServerManager.shouldPerformScheduledRestart(
                capturedGeneration: 4,
                currentGeneration: 4,
                autoStartEnabled: false,
                stopInProgress: false
            )
        )
        XCTAssertFalse(
            ServerManager.shouldPerformScheduledRestart(
                capturedGeneration: 4,
                currentGeneration: 4,
                autoStartEnabled: true,
                stopInProgress: true
            )
        )
    }

    func testFailedLaunchTerminatorStopsTheOwnedChild() async throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["30"]
        try process.run()
        XCTAssertTrue(process.isRunning)

        await ServerManager.terminateOwnedProcess(process)

        XCTAssertFalse(process.isRunning)
    }

    func testSingleInstancePolicySelectsOldestLiveMatchingProcess() {
        let now = Date()
        let candidates = [
            RunningApplicationSnapshot(
                processIdentifier: 900,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: now,
                isTerminated: false
            ),
            RunningApplicationSnapshot(
                processIdentifier: 100,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: now.addingTimeInterval(-60),
                isTerminated: false
            ),
            RunningApplicationSnapshot(
                processIdentifier: 200,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: now.addingTimeInterval(-30),
                isTerminated: false
            ),
            RunningApplicationSnapshot(
                processIdentifier: 50,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: now.addingTimeInterval(-120),
                isTerminated: true
            ),
            RunningApplicationSnapshot(
                processIdentifier: 25,
                bundleIdentifier: "com.example.Other",
                launchDate: now.addingTimeInterval(-180),
                isTerminated: false
            ),
        ]

        XCTAssertEqual(
            SingleInstancePolicy.existingProcessIdentifier(
                bundleIdentifier: "com.heznpc.AirMCP",
                currentProcessIdentifier: 900,
                candidates: candidates
            ),
            100
        )
    }

    func testSingleInstancePolicyAllowsLaunchWithoutAnotherMatchingProcess() {
        let candidates = [
            RunningApplicationSnapshot(
                processIdentifier: 900,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: Date(),
                isTerminated: false
            ),
        ]

        XCTAssertNil(
            SingleInstancePolicy.existingProcessIdentifier(
                bundleIdentifier: "com.heznpc.AirMCP",
                currentProcessIdentifier: 900,
                candidates: candidates
            )
        )
    }

    func testSimultaneousLaunchesChooseOneDeterministicWinner() {
        let sameDate = Date()
        let candidates = [
            RunningApplicationSnapshot(
                processIdentifier: 100,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: sameDate,
                isTerminated: false
            ),
            RunningApplicationSnapshot(
                processIdentifier: 200,
                bundleIdentifier: "com.heznpc.AirMCP",
                launchDate: sameDate,
                isTerminated: false
            ),
        ]

        XCTAssertNil(
            SingleInstancePolicy.existingProcessIdentifier(
                bundleIdentifier: "com.heznpc.AirMCP",
                currentProcessIdentifier: 100,
                candidates: candidates
            )
        )
        XCTAssertEqual(
            SingleInstancePolicy.existingProcessIdentifier(
                bundleIdentifier: "com.heznpc.AirMCP",
                currentProcessIdentifier: 200,
                candidates: candidates
            ),
            100
        )
    }

    func testHealthResponseClassifiesAConflictingRuntimeVersion() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "status": "ok",
            "version": "2.12.1",
            "appOwned": true,
        ])

        XCTAssertEqual(
            ServerManager.classifyRuntimeHealthResponse(
                statusCode: 200,
                data: data,
                expectedVersion: "2.16.0"
            ),
            .versionMismatch(found: "2.12.1", expected: "2.16.0")
        )
    }

    func testMatchingHealthStillRequiresAuthenticatedMCPReadiness() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "status": "ok",
            "version": "2.16.0",
            "appOwned": true,
        ])
        let health = ServerManager.classifyRuntimeHealthResponse(
            statusCode: 200,
            data: data,
            expectedVersion: "2.16.0"
        )

        XCTAssertEqual(
            ServerManager.completeRuntimeProbe(health: health, authenticatedReady: false),
            .authenticationFailed(version: "2.16.0")
        )
        XCTAssertEqual(
            ServerManager.completeRuntimeProbe(health: health, authenticatedReady: true),
            .ready(version: "2.16.0", appOwned: true)
        )
    }

    func testOnlyFreshUnavailableProbeCanUseFutureStartConfigPolicy() {
        XCTAssertTrue(ServerManager.runtimeIsConfirmedUnavailable(.unavailable))
        XCTAssertFalse(
            ServerManager.runtimeIsConfirmedUnavailable(
                .ready(version: "2.16.0", appOwned: true)
            )
        )
        XCTAssertFalse(
            ServerManager.runtimeIsConfirmedUnavailable(
                .ready(version: "2.16.0", appOwned: false)
            )
        )
        XCTAssertFalse(ServerManager.runtimeIsConfirmedUnavailable(.portOccupied))
        XCTAssertFalse(
            ServerManager.runtimeIsConfirmedUnavailable(
                .versionMismatch(found: "2.15.0", expected: "2.16.0")
            )
        )
        XCTAssertFalse(
            ServerManager.runtimeIsConfirmedUnavailable(
                .authenticationFailed(version: "2.16.0")
            )
        )
    }

    func testAuthenticatedManualRuntimeRemainsReadyWithoutAppOwnership() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "status": "ok",
            "version": "2.16.0",
            "appOwned": false,
        ])
        let health = ServerManager.classifyRuntimeHealthResponse(
            statusCode: 200,
            data: data,
            expectedVersion: "2.16.0"
        )

        XCTAssertEqual(
            ServerManager.completeRuntimeProbe(health: health, authenticatedReady: true),
            .ready(version: "2.16.0", appOwned: false)
        )
    }

    func testHealthWithoutOwnershipContractDefaultsToManualRuntime() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "status": "ok",
            "version": "2.16.0",
        ])

        XCTAssertEqual(
            ServerManager.completeRuntimeProbe(
                health: ServerManager.classifyRuntimeHealthResponse(
                    statusCode: 200,
                    data: data,
                    expectedVersion: "2.16.0"
                ),
                authenticatedReady: true
            ),
            .ready(version: "2.16.0", appOwned: false)
        )
    }

    func testMalformedHttpResponseStillIdentifiesAnOccupiedPort() {
        XCTAssertEqual(
            ServerManager.classifyRuntimeHealthResponse(
                statusCode: 503,
                data: Data("not-json".utf8),
                expectedVersion: "2.16.0"
            ),
            .occupiedUnrecognized
        )
        XCTAssertEqual(
            ServerManager.completeRuntimeProbe(
                health: .occupiedUnrecognized,
                authenticatedReady: false
            ),
            .portOccupied
        )
    }

    func testNoHttpResponseMeansThePortIsAvailable() {
        XCTAssertEqual(
            ServerManager.classifyRuntimeHealthResponse(
                statusCode: nil,
                data: Data(),
                expectedVersion: "2.16.0"
            ),
            .unavailable
        )
    }

    func testRefusedConnectionAllowsLaunchButAmbiguousTransportFailuresBlockIt() {
        XCTAssertEqual(
            ServerManager.classifyRuntimeTransportFailure(code: .cannotConnectToHost),
            .unavailable
        )
        XCTAssertEqual(
            ServerManager.classifyRuntimeTransportFailure(code: .timedOut),
            .occupiedUnrecognized
        )
        XCTAssertEqual(
            ServerManager.classifyRuntimeTransportFailure(code: .networkConnectionLost),
            .occupiedUnrecognized
        )
        XCTAssertEqual(
            ServerManager.classifyRuntimeTransportFailure(code: nil),
            .occupiedUnrecognized
        )
    }

    func testUntrustedHealthVersionCannotInjectDiagnosticText() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "status": "ok",
            "version": "2.12.1\nBearer private-value",
            "appOwned": true,
        ])

        XCTAssertEqual(
            ServerManager.classifyRuntimeHealthResponse(
                statusCode: 200,
                data: data,
                expectedVersion: "2.16.0"
            ),
            .occupiedUnrecognized
        )
    }

    func testVersionConflictIsShownAndLoggedWithoutSecretsOrRepeatedSpam() async {
        await MainActor.run {
            let manager = ServerManager()
            let logs = LogManager()
            manager.logManager = logs

            let conflict = ServerManager.RuntimeProbeResult.versionMismatch(
                found: "2.12.1",
                expected: "2.16.0"
            )
            manager.applyRuntimeProbe(conflict, preserveExistingErrorWhenUnavailable: false)
            manager.applyRuntimeProbe(conflict, preserveExistingErrorWhenUnavailable: false)

            guard case .error(let message) = manager.status else {
                return XCTFail("Expected a visible port-owner diagnostic")
            }
            XCTAssertTrue(message.contains("3847"))
            XCTAssertTrue(message.contains("2.12.1"))
            XCTAssertTrue(message.contains("2.16.0"))
            XCTAssertFalse(message.localizedCaseInsensitiveContains("token"))
            XCTAssertEqual(logs.entries.count, 1)
            XCTAssertEqual(logs.entries.first?.message, message)
            XCTAssertEqual(logs.entries.first?.isError, true)

            manager.applyRuntimeProbe(.unavailable, preserveExistingErrorWhenUnavailable: true)
            XCTAssertEqual(manager.status, .stopped)
        }
    }

    func testVerifiedExternalRuntimeTerminatesOnlyItsExactPIDWithAppLifecycle() async {
        let recorder = RuntimeTerminationRecorder()
        let identity = try! XCTUnwrap(
            AppOwnedRuntimeIdentity(
                processIdentifier: 4242,
                ownerFingerprint: String(repeating: "a", count: 64)
            )
        )
        await MainActor.run {
            let manager = ServerManager(adoptedRuntimeTerminator: { terminatedIdentity in
                recorder.record(terminatedIdentity.processIdentifier)
            })
            manager.applyRuntimeProbe(
                .ready(version: "2.16.0", appOwned: true),
                preserveExistingErrorWhenUnavailable: false,
                verifiedAdoptedIdentity: identity
            )
            XCTAssertTrue(manager.canStopRuntime)

            manager.prepareForApplicationTermination()
        }

        XCTAssertEqual(recorder.processIdentifiers, [4242])
    }

    func testPublicOwnershipBitAloneNeverGrantsTerminationAuthority() async {
        let recorder = RuntimeTerminationRecorder()
        await MainActor.run {
            let manager = ServerManager(adoptedRuntimeTerminator: { identity in
                recorder.record(identity.processIdentifier)
            })
            manager.applyRuntimeProbe(
                .ready(version: "2.16.0", appOwned: true),
                preserveExistingErrorWhenUnavailable: false
            )
            XCTAssertEqual(manager.status, .running)
            XCTAssertFalse(manager.canStopRuntime)
            manager.prepareForApplicationTermination()
        }

        XCTAssertTrue(recorder.processIdentifiers.isEmpty)
    }

    func testAuthenticatedManualRuntimeIsDisplayedButNotTerminatedWithApp() async {
        let recorder = RuntimeTerminationRecorder()
        await MainActor.run {
            let manager = ServerManager(adoptedRuntimeTerminator: { identity in
                recorder.record(identity.processIdentifier)
            })
            manager.applyRuntimeProbe(
                .ready(version: "2.16.0", appOwned: false),
                preserveExistingErrorWhenUnavailable: false
            )
            XCTAssertEqual(manager.status, .running)
            XCTAssertFalse(manager.canStopRuntime)

            manager.prepareForApplicationTermination()
        }

        XCTAssertTrue(recorder.processIdentifiers.isEmpty)
    }

    func testAuthenticatedIdentityFailsClosedForEveryMismatch() throws {
        let fingerprint = String(repeating: "b", count: 64)
        let state = AppRuntimeState(
            status: "ok",
            version: "2.16.0",
            appOwned: true,
            pid: 4242,
            ownerFingerprint: fingerprint,
            disabledModules: [],
            scopeFingerprint: String(repeating: "c", count: 64),
            enabledModules: ["calendar"],
            unavailableModules: [],
            effectiveHitlLevel: .sensitiveOnly,
            effectiveHitlWhitelist: []
        )
        XCTAssertEqual(
            ServerManager.authenticatedOwnedRuntimeIdentity(
                state: state,
                expectedVersion: "2.16.0",
                expectedOwnerFingerprint: fingerprint
            )?.processIdentifier,
            4242
        )
        XCTAssertNil(
            ServerManager.authenticatedOwnedRuntimeIdentity(
                state: state,
                expectedVersion: "2.15.0",
                expectedOwnerFingerprint: fingerprint
            )
        )
        XCTAssertNil(
            ServerManager.authenticatedOwnedRuntimeIdentity(
                state: state,
                expectedVersion: "2.16.0",
                expectedOwnerFingerprint: String(repeating: "d", count: 64)
            )
        )
        XCTAssertNil(
            ServerManager.authenticatedOwnedRuntimeIdentity(
                state: AppRuntimeState(
                    status: "ok",
                    version: "2.16.0",
                    appOwned: false,
                    pid: 4242,
                    ownerFingerprint: fingerprint,
                    disabledModules: [],
                    scopeFingerprint: String(repeating: "c", count: 64),
                    enabledModules: ["calendar"],
                    unavailableModules: [],
                    effectiveHitlLevel: .sensitiveOnly,
                    effectiveHitlWhitelist: []
                ),
                expectedVersion: "2.16.0",
                expectedOwnerFingerprint: fingerprint
            )
        )
        XCTAssertNil(
            ServerManager.authenticatedOwnedRuntimeIdentity(
                state: AppRuntimeState(
                    status: "ok",
                    version: "2.16.0",
                    appOwned: true,
                    pid: 1,
                    ownerFingerprint: fingerprint,
                    disabledModules: [],
                    scopeFingerprint: String(repeating: "c", count: 64),
                    enabledModules: ["calendar"],
                    unavailableModules: [],
                    effectiveHitlLevel: .sensitiveOnly,
                    effectiveHitlWhitelist: []
                ),
                expectedVersion: "2.16.0",
                expectedOwnerFingerprint: fingerprint
            )
        )
    }

    func testExactPIDSignalLeavesUnrelatedMatchingProcessRunning() throws {
        let target = Process()
        target.executableURL = URL(fileURLWithPath: "/bin/sleep")
        target.arguments = ["30"]
        let unrelated = Process()
        unrelated.executableURL = URL(fileURLWithPath: "/bin/sleep")
        unrelated.arguments = ["30"]
        try target.run()
        try unrelated.run()
        defer {
            if target.isRunning { target.terminate() }
            if unrelated.isRunning { unrelated.terminate() }
        }
        let identity = try XCTUnwrap(
            AppOwnedRuntimeIdentity(
                processIdentifier: Int(target.processIdentifier),
                ownerFingerprint: String(repeating: "e", count: 64)
            )
        )

        XCTAssertTrue(ServerManager.signalExactProcess(identity, signal: SIGTERM))
        target.waitUntilExit()
        XCTAssertFalse(target.isRunning)
        XCTAssertTrue(unrelated.isRunning)
    }

    func testUnavailableRuntimeClearsAdoptedTerminationResponsibility() async {
        let recorder = RuntimeTerminationRecorder()
        let identity = try! XCTUnwrap(
            AppOwnedRuntimeIdentity(
                processIdentifier: 5252,
                ownerFingerprint: String(repeating: "f", count: 64)
            )
        )
        await MainActor.run {
            let manager = ServerManager(adoptedRuntimeTerminator: { terminatedIdentity in
                recorder.record(terminatedIdentity.processIdentifier)
            })
            manager.applyRuntimeProbe(
                .ready(version: "2.16.0", appOwned: true),
                preserveExistingErrorWhenUnavailable: false,
                verifiedAdoptedIdentity: identity
            )
            manager.applyRuntimeProbe(
                .unavailable,
                preserveExistingErrorWhenUnavailable: false
            )

            manager.prepareForApplicationTermination()
        }

        XCTAssertTrue(recorder.processIdentifiers.isEmpty)
    }
}

private final class RuntimeTerminationRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Int32] = []

    var processIdentifiers: [Int32] {
        lock.withLock { values }
    }

    func record(_ processIdentifier: Int32) {
        lock.withLock { values.append(processIdentifier) }
    }
}
