import Darwin
import Foundation
import ServiceManagement

/// One monotonic epoch spans start, stop, crash-restart, and status probing.
/// Async work may publish a result only while its captured epoch is current.
struct RuntimeOperationGate: Sendable {
    private(set) var generation: UInt64 = 0

    mutating func advance() -> UInt64 {
        generation &+= 1
        return generation
    }

    func accepts(_ capturedGeneration: UInt64) -> Bool {
        capturedGeneration == generation
    }
}

private final class SynchronousRuntimeStateBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: AppRuntimeState?

    func store(_ state: AppRuntimeState?) {
        lock.withLock { value = state }
    }

    func load() -> AppRuntimeState? {
        lock.withLock { value }
    }
}

@MainActor
@Observable
final class ServerManager {

    enum Status: Sendable, Equatable {
        case running
        case stopped
        case checking
        case error(String)
    }

    enum RuntimeHealthResponse: Sendable, Equatable {
        case unavailable
        case occupiedUnrecognized
        case matching(version: String, appOwned: Bool)
        case versionMismatch(found: String, expected: String)
    }

    enum RuntimeProbeResult: Sendable, Equatable {
        case ready(version: String, appOwned: Bool)
        case unavailable
        case portOccupied
        case versionMismatch(found: String, expected: String)
        case authenticationFailed(version: String)
    }

    struct OnboardingRuntimeReceipt: Sendable, Equatable {
        let generation: UInt64
        let version: String
        let draftFingerprint: String
        let runtimeFingerprint: String
        let tokenFingerprint: String
        let enabledModules: [String]
        let unavailableModules: [AppRuntimeModuleUnavailable]
        let effectiveHitlLevel: HitlLevel
        let effectiveHitlWhitelist: [String]
    }

    enum OnboardingRuntimeActivationResult: Sendable, Equatable {
        case ready(OnboardingRuntimeReceipt)
        case manualRuntime(version: String)
        case failed(String)
    }

    var status: Status = .checking
    var autoStartEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: AirMcpConstants.keyAutoStart) }
        set { UserDefaults.standard.set(newValue, forKey: AirMcpConstants.keyAutoStart) }
    }
    var launchAtLoginEnabled: Bool
    var launchAtLoginError: String?

    private var timer: Timer?
    private var serverProcess: Process?
    var logManager: LogManager?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var isShuttingDown = false
    private var lastRuntimeDiagnostic: String?
    private var startAttemptID: UUID?
    private var operationGate = RuntimeOperationGate()
    private var statusProbeSequence: UInt64 = 0
    private var stopOperationGeneration: UInt64?
    private var ownedRuntimeIdentity: AppOwnedRuntimeIdentity?
    private let adoptedRuntimeTerminator: @Sendable (AppOwnedRuntimeIdentity) -> Void
    private var onboardingActivationInProgress = false
    private var onboardingRuntimeControlAuthorized = false
    private var onboardingRuntimeGeneration: UInt64 = 0
    private var onboardingScopeRevision: UInt64 = 0

    /// Only a live child launched by this app or an authenticated runtime whose
    /// exact PID and app-only owner fingerprint were verified may be stopped.
    /// A same-token manual runtime remains usable, but its lifecycle belongs to
    /// the terminal or service that launched it.
    var canStopRuntime: Bool {
        serverProcess?.isRunning == true || ownedRuntimeIdentity != nil
    }

    // MARK: - Crash Restart Tracking

    private var restartTimestamps: [Date] = []
    private static let maxRestartAttempts = 3
    private static let restartWindowSeconds: TimeInterval = 300  // 5 minutes
    nonisolated static let appOwnedReadinessTimeoutSeconds: TimeInterval = 12
    private nonisolated static let individualReadinessProbeTimeout: Duration = .seconds(2)

    init(
        adoptedRuntimeTerminator: @escaping @Sendable (AppOwnedRuntimeIdentity) -> Void = { identity in
            ServerManager.terminateVerifiedAdoptedRuntimeSynchronously(identity)
        }
    ) {
        self.adoptedRuntimeTerminator = adoptedRuntimeTerminator
        launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
                autoStartEnabled = true
            } else {
                try SMAppService.mainApp.unregister()
            }
            launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
            launchAtLoginError = nil
        } catch {
            launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
            launchAtLoginError = error.localizedDescription
        }
    }

    // MARK: - Polling

    func startPolling() {
        guard timer == nil else { return }
        checkStatus()
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkStatus()
            }
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    @discardableResult
    private func beginRuntimeOperation() -> UInt64 {
        // Advancing the probe sequence also invalidates an older probe that was
        // launched during the previous lifecycle epoch.
        statusProbeSequence &+= 1
        return operationGate.advance()
    }

    func checkStatus() {
        let operationGeneration = operationGate.generation
        statusProbeSequence &+= 1
        let probeSequence = statusProbeSequence
        Task.detached {
            let probe = await Self.probeAppOwnedRuntime()
            let verifiedIdentity = await Self.verifiedAdoptedRuntimeIdentity(for: probe)
            await MainActor.run { [weak self] in
                guard let self,
                      self.operationGate.accepts(operationGeneration),
                      self.statusProbeSequence == probeSequence,
                      self.startAttemptID == nil,
                      self.stopOperationGeneration == nil
                else { return }
                self.applyRuntimeProbe(
                    probe,
                    preserveExistingErrorWhenUnavailable: true,
                    verifiedAdoptedIdentity: verifiedIdentity
                )
            }
        }
    }

    // MARK: - Server Control

    func startServer() {
        guard !isShuttingDown,
              (!onboardingActivationInProgress || onboardingRuntimeControlAuthorized),
              status != .running,
              serverProcess?.isRunning != true,
              startAttemptID == nil,
              stopOperationGeneration == nil
        else { return }
        let operationGeneration = beginRuntimeOperation()
        let attemptID = UUID()
        startAttemptID = attemptID
        status = .checking

        Task {
            defer {
                if startAttemptID == attemptID {
                    startAttemptID = nil
                }
            }
            let existingProbe = await Self.probeAppOwnedRuntime()
            let existingIdentity = await Self.verifiedAdoptedRuntimeIdentity(for: existingProbe)
            guard operationGate.accepts(operationGeneration),
                  startAttemptID == attemptID
            else { return }
            if case .unavailable = existingProbe {
                // No listener owns the app runtime port; continue with launch.
            } else {
                applyRuntimeProbe(
                    existingProbe,
                    preserveExistingErrorWhenUnavailable: false,
                    verifiedAdoptedIdentity: existingIdentity
                )
                return
            }

            var pipes: (stdout: Pipe, stderr: Pipe)?
            if let logManager {
                pipes = logManager.makePipes()
            }
            let result = await Self.launchServer(stdoutPipe: pipes?.stdout, stderrPipe: pipes?.stderr)
            guard operationGate.accepts(operationGeneration),
                  startAttemptID == attemptID
            else {
                if case .success(let process, let expectedOwnerFingerprint) = result {
                    await Self.terminateOwnedProcess(process)
                    let probe = await Self.probeAppOwnedRuntime()
                    if let identity = await Self.verifiedAdoptedRuntimeIdentity(for: probe),
                       identity.ownerFingerprint == expectedOwnerFingerprint {
                        _ = await Self.terminateVerifiedAdoptedRuntime(identity)
                    }
                }
                if let pipes, let logManager {
                    logManager.detachPipes(stdout: pipes.stdout, stderr: pipes.stderr)
                }
                return
            }
            switch result {
            case .success(let process, let expectedOwnerFingerprint):
                ownedRuntimeIdentity = nil
                serverProcess = process
                stdoutPipe = pipes?.stdout
                stderrPipe = pipes?.stderr
                installTerminationHandler(on: process)
                let readiness = await Self.waitForAppOwnedRuntime()
                guard operationGate.accepts(operationGeneration),
                      startAttemptID == attemptID
                else { return }
                switch readiness {
                case .ready(_, appOwned: true):
                    let runtimeIdentity = await Self.verifiedAdoptedRuntimeIdentity(for: readiness)
                    guard runtimeIdentity?.ownerFingerprint == expectedOwnerFingerprint else {
                        await cleanupFailedLaunch(process: process, pipes: pipes)
                        guard operationGate.accepts(operationGeneration),
                              startAttemptID == attemptID
                        else { return }
                        applyRuntimeProbe(
                            readiness,
                            preserveExistingErrorWhenUnavailable: false,
                            verifiedAdoptedIdentity: runtimeIdentity
                        )
                        return
                    }
                    applyRuntimeProbe(
                        readiness,
                        preserveExistingErrorWhenUnavailable: false,
                        verifiedAdoptedIdentity: runtimeIdentity
                    )
                case .ready, .portOccupied, .versionMismatch, .authenticationFailed:
                    // A listener other than the child we just launched won the
                    // port, or the child never reached authenticated readiness.
                    // Relinquish the failed child before publishing a retryable
                    // UI state; otherwise Error shows a Start button that the
                    // live `serverProcess` guard can never honor.
                    await cleanupFailedLaunch(process: process, pipes: pipes)
                    guard operationGate.accepts(operationGeneration),
                          startAttemptID == attemptID
                    else { return }
                    applyRuntimeProbe(readiness, preserveExistingErrorWhenUnavailable: false)
                case .unavailable:
                    await cleanupFailedLaunch(process: process, pipes: pipes)
                    guard operationGate.accepts(operationGeneration),
                          startAttemptID == attemptID
                    else { return }
                    let message = "App-owned runtime failed authenticated readiness"
                    lastRuntimeDiagnostic = nil
                    logManager?.append(message, isError: true)
                    status = .error(message)
                }
            case .failure(let error):
                if let pipes, let logManager {
                    logManager.detachPipes(stdout: pipes.stdout, stderr: pipes.stderr)
                }
                logManager?.append(error, isError: true)
                status = .error(error)
            }
        }
    }

    /// A spawned runtime is ours even when it never becomes reachable. Detach
    /// its callback and pipes, then terminate it off the main actor before the
    /// Start action becomes available again.
    private func cleanupFailedLaunch(
        process: Process,
        pipes: (stdout: Pipe, stderr: Pipe)?
    ) async {
        process.terminationHandler = nil
        if serverProcess === process {
            serverProcess = nil
        }
        if let pipes, let logManager {
            logManager.detachPipes(stdout: pipes.stdout, stderr: pipes.stderr)
        }
        if stdoutPipe === pipes?.stdout { stdoutPipe = nil }
        if stderrPipe === pipes?.stderr { stderrPipe = nil }
        await Self.terminateOwnedProcess(process)
    }

    nonisolated static func terminateOwnedProcess(_ process: Process) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().async {
                if process.isRunning {
                    process.terminate()
                }
                for _ in 0..<20 where process.isRunning {
                    usleep(50_000)
                }
                if process.isRunning {
                    _ = Darwin.kill(process.processIdentifier, SIGKILL)
                    process.waitUntilExit()
                }
                continuation.resume()
            }
        }
    }

    /// Signal exactly one previously verified runtime PID. Command-line
    /// pattern matching is intentionally forbidden: another manual AirMCP
    /// process may use the same arguments without belonging to this app.
    @discardableResult
    nonisolated static func signalExactProcess(
        _ identity: AppOwnedRuntimeIdentity,
        signal: Int32
    ) -> Bool {
        Darwin.kill(identity.processIdentifier, signal) == 0
    }

    /// Auto-start the server after the user enables it. This also resumes an
    /// interrupted final onboarding step where runtime access was already
    /// granted before the user pressed Finish.
    func autoStartIfNeeded() {
        guard autoStartEnabled, status != .running else { return }
        // `startServer` owns the serialized probe-and-launch transaction. A
        // separate preflight task could otherwise outlive a user Stop action.
        startServer()
    }

    func stopServer() {
        guard (!onboardingActivationInProgress || onboardingRuntimeControlAuthorized),
              stopOperationGeneration == nil,
              canStopRuntime
        else { return }
        let operationGeneration = beginRuntimeOperation()
        stopOperationGeneration = operationGeneration
        // Invalidate a launch that is probing or spawning. If its child has
        // already been created, the start task terminates it before adoption.
        startAttemptID = nil
        status = .checking
        logManager?.detachPipes(stdout: stdoutPipe, stderr: stderrPipe)
        stdoutPipe = nil
        stderrPipe = nil

        let managedProcess = serverProcess
        let adoptedIdentity = ownedRuntimeIdentity
        // Explicit Stop owns this transition. Detach the crash callback before
        // inspecting `isRunning` so a just-exited child cannot start a newer
        // crash epoch and strand the stop operation.
        managedProcess?.terminationHandler = nil
        serverProcess = nil
        ownedRuntimeIdentity = nil

        if let process = managedProcess {
            Task {
                await Self.terminateOwnedProcess(process)
                if let adoptedIdentity,
                   adoptedIdentity.processIdentifier != process.processIdentifier {
                    _ = await Self.terminateVerifiedAdoptedRuntime(adoptedIdentity)
                }
                await settleStop(operationGeneration: operationGeneration)
            }
        } else {
            // Reaching this branch requires an exact authenticated PID + owner
            // fingerprint captured from the runtime-state endpoint. Revalidate
            // that identity immediately before signalling only that PID.
            guard let adoptedIdentity else {
                stopOperationGeneration = nil
                status = .stopped
                return
            }
            Task {
                _ = await Self.terminateVerifiedAdoptedRuntime(adoptedIdentity)
                guard operationGate.accepts(operationGeneration),
                      stopOperationGeneration == operationGeneration
                else { return }
                await settleStop(operationGeneration: operationGeneration)
            }
        }
    }

    private func settleStop(operationGeneration: UInt64) async {
        try? await Task.sleep(nanoseconds: 500_000_000)
        guard operationGate.accepts(operationGeneration),
              stopOperationGeneration == operationGeneration
        else { return }
        let probe = await Self.probeAppOwnedRuntime()
        let verifiedIdentity = await Self.verifiedAdoptedRuntimeIdentity(for: probe)
        guard operationGate.accepts(operationGeneration),
              stopOperationGeneration == operationGeneration
        else { return }
        stopOperationGeneration = nil
        applyRuntimeProbe(
            probe,
            preserveExistingErrorWhenUnavailable: false,
            verifiedAdoptedIdentity: verifiedIdentity
        )
    }

    /// Invalidate any receipt/activation tied to the previous Setup selection.
    /// An app-owned runtime using that old selection is stopped; an authenticated
    /// manual runtime is deliberately left under its launcher's control.
    func noteOnboardingScopeChanged() {
        onboardingScopeRevision &+= 1
        guard !onboardingActivationInProgress, canStopRuntime else { return }
        stopServer()
    }

    /// One serialized stop → persist+verify → start → runtime-state-verify
    /// transaction for Setup. The runtime is never connected to clients until
    /// both the config bytes and authenticated effective scope agree.
    func activateOnboardingRuntime(
        for scope: OnboardingRuntimeScope,
        configManager: ConfigManager
    ) async -> OnboardingRuntimeActivationResult {
        guard !onboardingActivationInProgress, !isShuttingDown else {
            return .failed("Another runtime activation is already in progress.")
        }
        onboardingActivationInProgress = true
        let capturedRevision = onboardingScopeRevision
        let previousDisabledModules = Array(Set(configManager.disabledModules)).sorted()
        let previousRuntimeFingerprint = OnboardingRuntimeScope(
            workflowID: configManager.config.onboardingWorkflow ?? "previous",
            disabledModules: previousDisabledModules
        ).runtimeFingerprint
        defer {
            onboardingRuntimeControlAuthorized = false
            onboardingActivationInProgress = false
        }

        guard await waitForRuntimeOperationsToSettle(),
              capturedRevision == onboardingScopeRevision
        else { return .failed("The Setup access selection changed before activation.") }

        let initialProbe = await Self.probeAppOwnedRuntime()
        guard capturedRevision == onboardingScopeRevision else {
            return .failed("The Setup access selection changed before activation.")
        }

        var previouslyOwnedRuntimeWasRunning = false
        switch initialProbe {
        case .ready(let version, appOwned: false):
            return .manualRuntime(version: version)
        case .ready(let version, appOwned: true):
            guard let state = try? await AppRuntimeClient.runtimeState(),
                  let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint(),
                  let runtimeIdentity = Self.authenticatedOwnedRuntimeIdentity(
                      state: state,
                      expectedVersion: version,
                      expectedOwnerFingerprint: expectedOwnerFingerprint
                  )
            else { return .failed("The running runtime identity could not be verified.") }
            ownedRuntimeIdentity = runtimeIdentity
            previouslyOwnedRuntimeWasRunning = true
            let stopped = await stopOwnedRuntimeAndWait()
            switch stopped {
            case .unavailable:
                break
            case .ready(let version, appOwned: false):
                return .manualRuntime(version: version)
            default:
                return .failed("The existing app-owned runtime did not stop completely.")
            }
        case .unavailable:
            if canStopRuntime {
                previouslyOwnedRuntimeWasRunning = true
                guard case .unavailable = await stopOwnedRuntimeAndWait() else {
                    return .failed("The existing app-owned runtime did not stop completely.")
                }
            }
        case .portOccupied, .versionMismatch, .authenticationFailed:
            return .failed(statusLabel)
        }

        guard capturedRevision == onboardingScopeRevision else {
            return .failed("The Setup access selection changed before the scope was saved.")
        }

        guard let transaction = configManager.beginOnboardingRuntimeScopeTransaction(scope) else {
            if previouslyOwnedRuntimeWasRunning {
                _ = await recoverPreviousAppOwnedRuntime(
                    disabledModules: previousDisabledModules,
                    runtimeFingerprint: previousRuntimeFingerprint
                )
            }
            return .failed(configManager.lastPersistenceError ?? "The Setup scope could not be saved.")
        }

        if capturedRevision != onboardingScopeRevision {
            _ = configManager.rollbackOnboardingRuntimeScope(transaction)
            return .failed("The Setup access selection changed while the scope was saved.")
        }

        startServerForOnboardingActivation()
        let startSettled = await waitForRuntimeOperationsToSettle()
        let activatedProbe = await Self.probeAppOwnedRuntime()
        let activatedToken = try? AppRuntimeToken.loadExisting()
        let activatedState: AppRuntimeState? = if let activatedToken {
            try? await AppRuntimeClient.runtimeStateWhenReady(
                token: activatedToken,
                timeout: .seconds(Self.appOwnedReadinessTimeoutSeconds)
            )
        } else {
            nil
        }
        let activatedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint()
        let activatedIdentity: AppOwnedRuntimeIdentity? = {
            guard case .ready(let version, appOwned: true) = activatedProbe,
                  let activatedState
            else { return nil }
            return Self.authenticatedOwnedRuntimeIdentity(
                state: activatedState,
                expectedVersion: version,
                expectedOwnerFingerprint: activatedOwnerFingerprint
            )
        }()
        let selectionStillCurrent = capturedRevision == onboardingScopeRevision
        let surfaceAssessment = activatedState.map {
            scope.assessRuntimeSurface(
                enabledModules: $0.enabledModules,
                unavailableModules: $0.unavailableModules
            )
        }
        let exactRuntimeReady: Bool = {
            guard startSettled,
                  selectionStillCurrent,
                  case .ready(let version, appOwned: true) = activatedProbe,
                  let activatedState,
                  activatedState.status == "ok",
                  activatedState.version == version,
                  activatedIdentity != nil,
                  activatedState.disabledModules == scope.disabledModules,
                  activatedState.scopeFingerprint == scope.runtimeFingerprint,
                  surfaceAssessment?.isAcceptable == true,
                  let activatedToken,
                  AppRuntimeToken.matchesExisting(activatedToken),
                  configManager.isOnboardingRuntimeScopePersisted(scope)
            else { return false }
            return true
        }()

        if exactRuntimeReady,
           case .ready(let version, appOwned: true) = activatedProbe,
           let activatedIdentity,
           let activatedState,
           let activatedToken {
            ownedRuntimeIdentity = activatedIdentity
            onboardingRuntimeGeneration &+= 1
            return .ready(
                OnboardingRuntimeReceipt(
                    generation: onboardingRuntimeGeneration,
                    version: version,
                    draftFingerprint: scope.draftFingerprint,
                    runtimeFingerprint: scope.runtimeFingerprint,
                    tokenFingerprint: AppRuntimeToken.fingerprint(for: activatedToken),
                    enabledModules: activatedState.enabledModules.sorted(),
                    unavailableModules: surfaceAssessment?.diagnosedUnavailableModules ?? [],
                    effectiveHitlLevel: activatedState.effectiveHitlLevel,
                    effectiveHitlWhitelist: activatedState.effectiveHitlWhitelist
                )
            )
        }

        // Never roll the file back while a child using the new bytes is still
        // live. Stop only an authenticated app-owned runtime; a manual process
        // that raced onto the port remains untouched and blocks recovery.
        var manualRuntimeVersion: String?
        if case .ready(let version, appOwned: false) = activatedProbe {
            manualRuntimeVersion = version
        } else if let activatedState, !activatedState.appOwned {
            manualRuntimeVersion = activatedState.version
        } else if canStopRuntime {
            let stopped = await stopOwnedRuntimeAndWait()
            if case .ready(let version, appOwned: false) = stopped {
                manualRuntimeVersion = version
            }
        } else if startAttemptID != nil {
            cancelPendingOnboardingStart()
            _ = await waitForRuntimeOperationsToSettle()
        }

        // A manual process that won the port after the new config was persisted
        // may already be running that scope. It is not ours to stop, and rolling
        // the file back underneath it would manufacture a file/runtime mismatch.
        // Keep client patching locked and leave the verified new bytes in place.
        if let manualRuntimeVersion {
            return .manualRuntime(version: manualRuntimeVersion)
        }

        guard configManager.rollbackOnboardingRuntimeScope(transaction) else {
            return .failed(configManager.lastPersistenceError ?? "The previous configuration could not be restored.")
        }

        if previouslyOwnedRuntimeWasRunning,
           selectionStillCurrent,
           manualRuntimeVersion == nil,
           !(await recoverPreviousAppOwnedRuntime(
               disabledModules: transaction.previousDisabledModules,
               runtimeFingerprint: transaction.previousRuntimeFingerprint
           )) {
            return .failed("The previous app-owned runtime could not be restored.")
        }

        let failureDetail = surfaceAssessment.flatMap { assessment in
            assessment.isAcceptable ? nil : assessment.failureDescription
        }
        return .failed(
            selectionStillCurrent
                ? (failureDetail ?? "The app-owned runtime did not load the exact saved scope.")
                : "The Setup access selection changed during activation."
        )
    }

    /// Revalidate a previously consented draft against the currently running
    /// process generation. The caller supplies the persisted draft receipt;
    /// without that receipt an arbitrary pre-existing runtime can never unlock
    /// client configuration.
    func validateOnboardingRuntime(
        for scope: OnboardingRuntimeScope,
        authorizedDraftFingerprint: String,
        runtimeToken: String,
        configManager: ConfigManager
    ) async -> OnboardingRuntimeActivationResult {
        guard authorizedDraftFingerprint == scope.draftFingerprint else {
            return .failed("The Setup access selection changed after runtime activation.")
        }
        let probe = await Self.probeAppOwnedRuntime()
        if case .ready(let version, appOwned: false) = probe {
            return .manualRuntime(version: version)
        }
        guard case .ready(let version, appOwned: true) = probe,
              let state = try? await AppRuntimeClient.runtimeState(token: runtimeToken),
              let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint(),
              let runtimeIdentity = Self.authenticatedOwnedRuntimeIdentity(
                  state: state,
                  expectedVersion: version,
                  expectedOwnerFingerprint: expectedOwnerFingerprint
              )
        else { return .failed("The app-owned runtime is not ready.") }
        guard state.disabledModules == scope.disabledModules,
              state.scopeFingerprint == scope.runtimeFingerprint,
              AppRuntimeToken.matchesExisting(runtimeToken),
              configManager.isOnboardingRuntimeScopePersisted(scope)
        else { return .failed("The running runtime scope does not match Setup.") }
        let surfaceAssessment = scope.assessRuntimeSurface(
            enabledModules: state.enabledModules,
            unavailableModules: state.unavailableModules
        )
        guard surfaceAssessment.isAcceptable else {
            return .failed(surfaceAssessment.failureDescription)
        }

        ownedRuntimeIdentity = runtimeIdentity
        onboardingRuntimeGeneration &+= 1
        return .ready(
            OnboardingRuntimeReceipt(
                generation: onboardingRuntimeGeneration,
                version: version,
                draftFingerprint: scope.draftFingerprint,
                runtimeFingerprint: scope.runtimeFingerprint,
                tokenFingerprint: AppRuntimeToken.fingerprint(for: runtimeToken),
                enabledModules: state.enabledModules.sorted(),
                unavailableModules: surfaceAssessment.diagnosedUnavailableModules,
                effectiveHitlLevel: state.effectiveHitlLevel,
                effectiveHitlWhitelist: state.effectiveHitlWhitelist
            )
        )
    }

    private func startServerForOnboardingActivation() {
        onboardingRuntimeControlAuthorized = true
        startServer()
        onboardingRuntimeControlAuthorized = false
    }

    private func stopOwnedRuntimeAndWait() async -> RuntimeProbeResult {
        onboardingRuntimeControlAuthorized = true
        stopServer()
        onboardingRuntimeControlAuthorized = false
        _ = await waitForRuntimeOperationsToSettle()
        return await Self.probeAppOwnedRuntime()
    }

    private func cancelPendingOnboardingStart() {
        _ = beginRuntimeOperation()
        startAttemptID = nil
        status = .stopped
    }

    private func waitForRuntimeOperationsToSettle(
        timeout: Duration = .seconds(20)
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while startAttemptID != nil || stopOperationGeneration != nil {
            guard clock.now < deadline else { return false }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return true
    }

    private func recoverPreviousAppOwnedRuntime(
        disabledModules: [String],
        runtimeFingerprint: String
    ) async -> Bool {
        let probe = await Self.probeAppOwnedRuntime()
        if case .ready(_, appOwned: false) = probe { return false }
        if case .ready(let version, appOwned: true) = probe {
            guard let state = try? await AppRuntimeClient.runtimeState(),
                  let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint(),
                  let runtimeIdentity = Self.authenticatedOwnedRuntimeIdentity(
                      state: state,
                      expectedVersion: version,
                      expectedOwnerFingerprint: expectedOwnerFingerprint
                  )
            else { return false }
            ownedRuntimeIdentity = runtimeIdentity
            guard case .unavailable = await stopOwnedRuntimeAndWait() else { return false }
        } else if case .unavailable = probe {
            // Port is available; start the runtime from the restored config.
        } else {
            return false
        }

        startServerForOnboardingActivation()
        guard await waitForRuntimeOperationsToSettle() else { return false }
        guard case .ready(let version, appOwned: true) = await Self.probeAppOwnedRuntime(),
              let state = try? await AppRuntimeClient.runtimeState(),
              let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint(),
              let runtimeIdentity = Self.authenticatedOwnedRuntimeIdentity(
                  state: state,
                  expectedVersion: version,
                  expectedOwnerFingerprint: expectedOwnerFingerprint
              ),
              state.disabledModules == disabledModules,
              state.scopeFingerprint == runtimeFingerprint
        else { return false }
        ownedRuntimeIdentity = runtimeIdentity
        return true
    }

    /// Synchronous best-effort cleanup for the macOS application lifecycle.
    /// Normal UI shutdown already calls `stopServer()`, but logout/restart and
    /// other AppKit termination paths must also signal the owned Node child so
    /// it cannot remain listening after the menu bar process exits.
    func prepareForApplicationTermination() {
        let runtimeIdentity = ownedRuntimeIdentity
        let managedProcess = serverProcess
        _ = beginRuntimeOperation()
        isShuttingDown = true
        startAttemptID = nil
        stopOperationGeneration = nil
        stopPolling()
        logManager?.detachPipes(stdout: stdoutPipe, stderr: stderrPipe)
        stdoutPipe = nil
        stderrPipe = nil
        managedProcess?.terminationHandler = nil
        if managedProcess?.isRunning == true {
            managedProcess?.terminate()
        }
        if let runtimeIdentity,
           managedProcess?.processIdentifier != runtimeIdentity.processIdentifier {
            adoptedRuntimeTerminator(runtimeIdentity)
        }
        serverProcess = nil
        ownedRuntimeIdentity = nil
    }

    // MARK: - Crash Detection & Auto-Restart

    private func installTerminationHandler(on process: Process) {
        process.terminationHandler = { [weak self] terminatedProcess in
            let exitCode = terminatedProcess.terminationStatus
            let reason = terminatedProcess.terminationReason
            Task { @MainActor [weak self] in
                guard let self else { return }
                // Ignore a delayed callback from a process that was already
                // stopped/replaced; it must not clobber the current child.
                guard self.serverProcess === terminatedProcess else { return }
                self.logManager?.detachPipes(stdout: self.stdoutPipe, stderr: self.stderrPipe)
                self.stdoutPipe = nil
                self.stderrPipe = nil
                self.serverProcess = nil
                self.startAttemptID = nil
                self.ownedRuntimeIdentity = nil

                if self.isShuttingDown {
                    self.status = .stopped
                    return
                }
                let crashGeneration = self.beginRuntimeOperation()

                if reason == .uncaughtSignal || exitCode != 0 {
                    let message = "Server process terminated unexpectedly (exit code: \(exitCode))"
                    self.logManager?.append(message, isError: true)

                    // A second AirMCP copy can make the new child fail with
                    // EADDRINUSE. Diagnose that owner instead of repeatedly
                    // launching children against the occupied port.
                    let probe = await Self.probeAppOwnedRuntime()
                    let verifiedIdentity = await Self.verifiedAdoptedRuntimeIdentity(for: probe)
                    guard self.operationGate.accepts(crashGeneration) else { return }
                    if case .unavailable = probe {
                        self.status = .stopped
                    } else {
                        self.applyRuntimeProbe(
                            probe,
                            preserveExistingErrorWhenUnavailable: false,
                            verifiedAdoptedIdentity: verifiedIdentity
                        )
                        return
                    }

                    if self.autoStartEnabled && self.canAttemptRestart() {
                        self.logManager?.append("Auto-restarting server in 3 seconds...", isError: false)
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        guard Self.shouldPerformScheduledRestart(
                            capturedGeneration: crashGeneration,
                            currentGeneration: self.operationGate.generation,
                            autoStartEnabled: self.autoStartEnabled,
                            stopInProgress: self.stopOperationGeneration != nil
                        ), !self.isShuttingDown,
                           self.serverProcess == nil,
                           self.startAttemptID == nil
                        else { return }
                        self.startServer()
                    }
                } else {
                    self.status = .stopped
                }
            }
        }
    }

    nonisolated static func shouldPerformScheduledRestart(
        capturedGeneration: UInt64,
        currentGeneration: UInt64,
        autoStartEnabled: Bool,
        stopInProgress: Bool
    ) -> Bool {
        capturedGeneration == currentGeneration
            && autoStartEnabled
            && !stopInProgress
    }

    private func canAttemptRestart() -> Bool {
        let now = Date()
        restartTimestamps = restartTimestamps.filter {
            now.timeIntervalSince($0) < Self.restartWindowSeconds
        }
        guard restartTimestamps.count < Self.maxRestartAttempts else {
            logManager?.append(
                "Auto-restart skipped: \(Self.maxRestartAttempts) restarts within \(Int(Self.restartWindowSeconds / 60)) minutes",
                isError: true
            )
            return false
        }
        restartTimestamps.append(now)
        return true
    }

    // MARK: - Static Process Launchers (nonisolated)

    private enum LaunchResult: Sendable {
        case success(Process, expectedOwnerFingerprint: String)
        case failure(String)
    }

    private static func launchServer(
        stdoutPipe: Pipe?,
        stderrPipe: Pipe?
    ) async -> LaunchResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                let executable: String
                let arguments: [String]
                if let runtime = AirMcpConstants.bundledServerRuntime {
                    executable = runtime.node
                    arguments = [runtime.entry, "--http", "--port", "\(AirMcpConstants.appOwnedHttpPort)"]
                } else {
                    guard let npxPath = NodeEnvironment.findExecutable(named: "npx") else {
                        continuation.resume(returning: .failure(
                            "Bundled runtime is unavailable and Node.js was not found"
                        ))
                        return
                    }
                    executable = npxPath
                    arguments = [
                        "-y",
                        AirMcpConstants.npmPackageSpecifier,
                        "--http",
                        "--port",
                        "\(AirMcpConstants.appOwnedHttpPort)",
                    ]
                }
                let token: String
                let ownerSecret: String
                do {
                    token = try AppRuntimeToken.ensure()
                    ownerSecret = try AppRuntimeToken.rotateOwnerSecret()
                } catch {
                    continuation.resume(returning: .failure(
                        "Failed to prepare app runtime token: \(error.localizedDescription)"
                    ))
                    return
                }

                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments
                process.standardOutput = stdoutPipe ?? FileHandle.nullDevice
                process.standardError = stderrPipe ?? FileHandle.nullDevice
                var env = NodeEnvironment.buildEnv()
                env["AIRMCP_ALLOW_NETWORK"] = "with-token"
                env["AIRMCP_HTTP_TOKEN"] = token
                env["AIRMCP_APP_OWNED_RUNTIME"] = "1"
                env["AIRMCP_APP_RUNTIME_OWNER_SECRET"] = ownerSecret
                if let bridge = AirMcpConstants.bundledBridgePath {
                    env["AIRMCP_BRIDGE_PATH"] = bridge
                }
                process.environment = env

                do {
                    try process.run()
                    continuation.resume(returning: .success(
                        process,
                        expectedOwnerFingerprint: AppRuntimeToken.ownerFingerprint(for: ownerSecret)
                    ))
                } catch {
                    continuation.resume(returning: .failure(
                        "Failed to launch server: \(error.localizedDescription)"
                    ))
                }
            }
        }
    }

    // MARK: - Process Utilities

    nonisolated static func classifyRuntimeHealthResponse(
        statusCode: Int?,
        data: Data,
        expectedVersion: String = AirMcpConstants.npmPackageVersion
    ) -> RuntimeHealthResponse {
        // Any HTTP response proves that a process owns the port. Only the
        // exact AirMCP health contract is allowed to advance to version/auth
        // readiness; other responses block a competing child launch.
        guard statusCode != nil else { return .unavailable }
        guard statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (json["status"] as? String) == "ok",
              let version = json["version"] as? String,
              version.count <= 64,
              version.range(
                  of: #"^[0-9]+(?:\.[0-9]+){2}(?:[-+][0-9A-Za-z.-]+)?$"#,
                  options: .regularExpression
              ) != nil
        else { return .occupiedUnrecognized }

        // Runtimes predating the ownership bit remain diagnosable and usable,
        // but absence or a malformed value can never grant app ownership.
        let appOwned = json["appOwned"] as? Bool ?? false

        guard version == expectedVersion else {
            return .versionMismatch(found: version, expected: expectedVersion)
        }
        return .matching(version: version, appOwned: appOwned)
    }

    nonisolated static func completeRuntimeProbe(
        health: RuntimeHealthResponse,
        authenticatedReady: Bool
    ) -> RuntimeProbeResult {
        switch health {
        case .unavailable:
            return .unavailable
        case .occupiedUnrecognized:
            return .portOccupied
        case .versionMismatch(let found, let expected):
            return .versionMismatch(found: found, expected: expected)
        case .matching(let version, let appOwned):
            return authenticatedReady
                ? .ready(version: version, appOwned: appOwned)
                : .authenticationFailed(version: version)
        }
    }

    /// Persisted policy describes a future app-owned start only when a fresh
    /// probe proves that no process is serving the reserved port. Every live,
    /// conflicting, mismatched, or authentication-failed result must be
    /// resolved from authenticated runtime evidence or rejected.
    nonisolated static func runtimeIsConfirmedUnavailable(_ probe: RuntimeProbeResult) -> Bool {
        if case .unavailable = probe { return true }
        return false
    }

    nonisolated static func classifyRuntimeTransportFailure(
        code: URLError.Code?
    ) -> RuntimeHealthResponse {
        // A refused localhost connection proves the port is available. A
        // timeout, TLS mismatch, or connection reset can all mean a raw/non-
        // HTTP listener owns it, so fail closed and block a competing launch.
        switch code {
        case .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet:
            return .unavailable
        default:
            return .occupiedUnrecognized
        }
    }

    nonisolated static func probeAppOwnedRuntime() async -> RuntimeProbeResult {
        guard let url = URL(string: AirMcpConstants.appOwnedHealthURL) else { return .unavailable }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.0

        let health: RuntimeHealthResponse
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            health = classifyRuntimeHealthResponse(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                data: data
            )
        } catch let error as URLError {
            health = classifyRuntimeTransportFailure(code: error.code)
        } catch {
            health = classifyRuntimeTransportFailure(code: nil)
        }

        switch health {
        case .matching:
            return completeRuntimeProbe(
                health: health,
                authenticatedReady: await AppRuntimeClient.probe()
            )
        case .unavailable, .occupiedUnrecognized, .versionMismatch:
            return completeRuntimeProbe(health: health, authenticatedReady: false)
        }
    }

    /// Convert authenticated runtime-state into lifecycle authority only when
    /// its version and app-only owner fingerprint match this installation.
    /// The public `appOwned` health bit alone is never sufficient.
    nonisolated static func authenticatedOwnedRuntimeIdentity(
        state: AppRuntimeState,
        expectedVersion: String,
        expectedOwnerFingerprint: String?
    ) -> AppOwnedRuntimeIdentity? {
        guard state.status == "ok",
              state.version == expectedVersion,
              state.appOwned,
              let expectedOwnerFingerprint,
              state.ownerFingerprint == expectedOwnerFingerprint
        else { return nil }
        return state.ownedIdentity
    }

    nonisolated static func verifiedAdoptedRuntimeIdentity(
        for probe: RuntimeProbeResult
    ) async -> AppOwnedRuntimeIdentity? {
        guard case .ready(let version, appOwned: true) = probe,
              let state = try? await AppRuntimeClient.runtimeState(),
              let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint()
        else { return nil }
        return authenticatedOwnedRuntimeIdentity(
            state: state,
            expectedVersion: version,
            expectedOwnerFingerprint: expectedOwnerFingerprint
        )
    }

    /// Revalidate the exact endpoint identity immediately before SIGTERM. A
    /// second identity check gates SIGKILL so PID reuse or a replacement
    /// listener can never inherit termination meant for an older process.
    private nonisolated static func terminateVerifiedAdoptedRuntime(
        _ expectedIdentity: AppOwnedRuntimeIdentity
    ) async -> Bool {
        let initialProbe = await probeAppOwnedRuntime()
        guard await verifiedAdoptedRuntimeIdentity(for: initialProbe) == expectedIdentity else {
            return false
        }
        guard signalExactProcess(expectedIdentity, signal: SIGTERM) else { return false }

        for _ in 0..<10 {
            try? await Task.sleep(for: .milliseconds(100))
            if Darwin.kill(expectedIdentity.processIdentifier, 0) == -1, errno == ESRCH {
                return true
            }
        }

        let finalProbe = await probeAppOwnedRuntime()
        guard await verifiedAdoptedRuntimeIdentity(for: finalProbe) == expectedIdentity else {
            return false
        }
        return signalExactProcess(expectedIdentity, signal: SIGKILL)
    }

    /// AppKit's termination callback is synchronous. Re-read the authenticated
    /// endpoint with a short bound before using the cached identity so PID reuse
    /// cannot turn application shutdown into a signal for another process.
    private nonisolated static func terminateVerifiedAdoptedRuntimeSynchronously(
        _ expectedIdentity: AppOwnedRuntimeIdentity
    ) {
        guard let state = synchronousRuntimeState(timeout: 0.75),
              let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint(),
              authenticatedOwnedRuntimeIdentity(
                  state: state,
                  expectedVersion: AirMcpConstants.npmPackageVersion,
                  expectedOwnerFingerprint: expectedOwnerFingerprint
              ) == expectedIdentity
        else { return }
        _ = signalExactProcess(expectedIdentity, signal: SIGTERM)
    }

    private nonisolated static func synchronousRuntimeState(
        timeout: TimeInterval
    ) -> AppRuntimeState? {
        guard let token = try? AppRuntimeToken.loadExisting(),
              let url = URL(string: AirMcpConstants.appOwnedRuntimeStateURL)
        else { return nil }

        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let box = SynchronousRuntimeStateBox()
        let semaphore = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let data,
                  let state = try? JSONDecoder().decode(AppRuntimeState.self, from: data)
            else { return }
            box.store(state)
        }
        task.resume()
        guard semaphore.wait(timeout: .now() + timeout) == .success else {
            task.cancel()
            return nil
        }
        return box.load()
    }

    /// Returns the exact version of the authenticated runtime at the app's
    /// reserved endpoint. The accompanying probe result separately carries
    /// whether the process declared app ownership; a manual same-token runtime
    /// is usable but is never adopted for application-termination cleanup.
    /// A bare health response is not sufficient because another AirMCP copy
    /// can own the port; the runtime must match this app and complete an MCP
    /// initialize/tools-list round trip with the current owner-only token.
    nonisolated static func authenticatedRuntimeVersionAtAppEndpoint() async -> String? {
        guard case .ready(let version, _) = await probeAppOwnedRuntime() else { return nil }
        return version
    }

    private nonisolated static func waitForAppOwnedRuntime() async -> RuntimeProbeResult {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(
            by: .milliseconds(Int64(appOwnedReadinessTimeoutSeconds * 1_000))
        )
        var lastProbe: RuntimeProbeResult = .unavailable
        while clock.now < deadline {
            let probe = await boundedAppOwnedRuntimeProbe()
            switch probe {
            case .ready, .portOccupied, .versionMismatch:
                return probe
            case .unavailable, .authenticationFailed:
                lastProbe = probe
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return lastProbe
    }

    private nonisolated static func boundedAppOwnedRuntimeProbe() async -> RuntimeProbeResult {
        await withTaskGroup(of: RuntimeProbeResult.self) { group in
            group.addTask { await probeAppOwnedRuntime() }
            group.addTask {
                try? await Task.sleep(for: individualReadinessProbeTimeout)
                return .unavailable
            }
            let first = await group.next() ?? .unavailable
            group.cancelAll()
            return first
        }
    }

    // MARK: - Display Helpers

    func applyRuntimeProbe(
        _ probe: RuntimeProbeResult,
        preserveExistingErrorWhenUnavailable: Bool,
        verifiedAdoptedIdentity: AppOwnedRuntimeIdentity? = nil
    ) {
        switch probe {
        case .ready(_, appOwned: true):
            // A public ownership bit and even the shared HTTP token are not
            // process authority. Only authenticated PID + per-launch owner
            // fingerprint evidence opens lifecycle controls.
            ownedRuntimeIdentity = verifiedAdoptedIdentity
            lastRuntimeDiagnostic = nil
            status = .running
        case .ready(_, appOwned: false):
            ownedRuntimeIdentity = nil
            lastRuntimeDiagnostic = nil
            status = .running
        case .versionMismatch(let found, let expected):
            ownedRuntimeIdentity = nil
            setRuntimeDiagnostic(
                L("server.runtimeVersionConflict", AirMcpConstants.appOwnedHttpPort, found, expected)
            )
        case .authenticationFailed(let version):
            ownedRuntimeIdentity = nil
            setRuntimeDiagnostic(
                L("server.runtimePortOwnerConflict", AirMcpConstants.appOwnedHttpPort, version)
            )
        case .portOccupied:
            ownedRuntimeIdentity = nil
            setRuntimeDiagnostic(
                L("server.runtimePortOccupied", AirMcpConstants.appOwnedHttpPort)
            )
        case .unavailable:
            ownedRuntimeIdentity = nil
            if lastRuntimeDiagnostic != nil {
                lastRuntimeDiagnostic = nil
                status = .stopped
            } else if !preserveExistingErrorWhenUnavailable {
                status = .stopped
            } else if case .error = status {
                // Preserve a process launch failure until a healthy runtime or
                // a more actionable port-owner diagnosis supersedes it.
            } else {
                status = .stopped
            }
        }
    }

    private func setRuntimeDiagnostic(_ message: String) {
        if lastRuntimeDiagnostic != message {
            logManager?.append(message, isError: true)
            lastRuntimeDiagnostic = message
        }
        status = .error(message)
    }

    var statusLabel: String {
        switch status {
        case .running: L("server.running")
        case .stopped: L("server.stopped")
        case .checking: L("server.checking")
        case .error(let message): message
        }
    }

    var statusIcon: String {
        switch status {
        case .running: "circle.fill"
        case .stopped: "circle"
        case .checking: "circle.dotted"
        case .error: "exclamationmark.triangle.fill"
        }
    }
}
