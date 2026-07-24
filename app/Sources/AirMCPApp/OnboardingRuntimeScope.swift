import CryptoKit
import Foundation

/// Canonical access selection that Setup applies to the persistent runtime.
/// The draft fingerprint includes the workflow identity for UI consent, while
/// the runtime fingerprint includes only the effective module scope that Node
/// can independently derive from its parsed configuration.
struct OnboardingRuntimeScope: Equatable, Sendable {
    let workflowID: String
    let disabledModules: [String]
    let requestedModules: [String]
    let requiredModules: [String]

    init(workflowID: String, disabledModules: some Sequence<String>) {
        self.workflowID = workflowID
        self.disabledModules = Array(Set(disabledModules)).sorted()
        requestedModules = Array(onboardingModuleIds.subtracting(self.disabledModules)).sorted()
        requiredModules = Array(
            onboardingWorkflows.first { $0.id == workflowID }?.requiredModules ?? []
        ).sorted()
    }

    var draftFingerprint: String {
        Self.sha256(
            "airmcp-onboarding-draft-v2\n\(workflowID)\nrequired\n"
                + requiredModules.joined(separator: "\n")
                + "\nrequested\n"
                + requestedModules.joined(separator: "\n")
                + "\ndisabled\n"
                + disabledModules.joined(separator: "\n")
        )
    }

    var runtimeFingerprint: String {
        Self.sha256(
            "airmcp-runtime-scope-v1\n"
                + disabledModules.joined(separator: "\n")
        )
    }

    private static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    func assessRuntimeSurface(
        enabledModules: some Sequence<String>,
        unavailableModules: some Sequence<AppRuntimeModuleUnavailable>
    ) -> OnboardingRuntimeSurfaceAssessment {
        let enabled = Set(enabledModules)
        let unavailableByName = Dictionary(
            unavailableModules.map { ($0.module, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let requested = Set(requestedModules)
        let missingRequested = requested.subtracting(enabled)
        let diagnosedUnavailable = missingRequested
            .compactMap { unavailableByName[$0] }
            .sorted { $0.module < $1.module }
        return OnboardingRuntimeSurfaceAssessment(
            missingRequiredModules: Set(requiredModules).subtracting(enabled).sorted(),
            undiagnosedRequestedModules: missingRequested
                .subtracting(unavailableByName.keys)
                .sorted(),
            unexpectedlyEnabledModules: enabled
                .intersection(disabledModules)
                .sorted(),
            diagnosedUnavailableModules: diagnosedUnavailable
        )
    }
}

struct OnboardingRuntimeSurfaceAssessment: Equatable, Sendable {
    let missingRequiredModules: [String]
    let undiagnosedRequestedModules: [String]
    let unexpectedlyEnabledModules: [String]
    let diagnosedUnavailableModules: [AppRuntimeModuleUnavailable]

    var isAcceptable: Bool {
        missingRequiredModules.isEmpty
            && undiagnosedRequestedModules.isEmpty
            && unexpectedlyEnabledModules.isEmpty
    }

    var failureDescription: String {
        var parts: [String] = []
        if !missingRequiredModules.isEmpty {
            parts.append("required modules were not loaded: \(missingRequiredModules.joined(separator: ", "))")
        }
        if !undiagnosedRequestedModules.isEmpty {
            parts.append("selected modules disappeared without an availability diagnosis: \(undiagnosedRequestedModules.joined(separator: ", "))")
        }
        if !unexpectedlyEnabledModules.isEmpty {
            parts.append("disabled modules were loaded: \(unexpectedlyEnabledModules.joined(separator: ", "))")
        }
        return parts.joined(separator: "; ")
    }
}
