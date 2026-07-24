import Foundation

struct OnboardingDraftState: Equatable, Sendable {
    var workflowID: String
    var disabledModules: Set<String>
    var appliedScopeFingerprint: String?

    init(
        workflowID: String,
        disabledModules: Set<String>,
        appliedScopeFingerprint: String? = nil
    ) {
        self.workflowID = workflowID
        self.disabledModules = disabledModules
        self.appliedScopeFingerprint = appliedScopeFingerprint
    }
}

enum OnboardingDraftStore {
    static func unmanagedDisabledModules(
        onboardingCompleted: Bool,
        configuredDisabledModules: [String],
        managedModuleIDs: Set<String>,
        allModuleIDs: Set<String>
    ) -> Set<String> {
        let configuredUnmanaged = Set(configuredDisabledModules).subtracting(managedModuleIDs)
        guard !onboardingCompleted else { return configuredUnmanaged }

        // First-run workflow presets grant only their explicitly presented
        // modules. Standard and opt-in modules absent from the Setup catalog
        // stay disabled instead of becoming an invisible side effect of the
        // switch to the custom profile.
        return configuredUnmanaged.union(allModuleIDs.subtracting(managedModuleIDs))
    }

    static func fallbackState(
        onboardingCompleted: Bool,
        configuredDisabledModules: [String],
        defaultWorkflowID: String,
        defaultDisabledModules: Set<String>,
        validModuleIDs: Set<String>
    ) -> OnboardingDraftState {
        OnboardingDraftState(
            workflowID: defaultWorkflowID,
            disabledModules: onboardingCompleted
                ? Set(configuredDisabledModules).intersection(validModuleIDs)
                : defaultDisabledModules
        )
    }

    static func load(
        defaults: UserDefaults = .standard,
        validWorkflowIDs: Set<String>,
        validModuleIDs: Set<String>,
        fallback: OnboardingDraftState
    ) -> OnboardingDraftState {
        guard let raw = defaults.dictionary(forKey: AirMcpConstants.keyOnboardingDraft),
              let workflowID = raw["workflowID"] as? String,
              validWorkflowIDs.contains(workflowID),
              let disabled = raw["disabledModules"] as? [String]
        else { return fallback }

        return OnboardingDraftState(
            workflowID: workflowID,
            disabledModules: Set(disabled).intersection(validModuleIDs),
            appliedScopeFingerprint: validatedFingerprint(raw["appliedScopeFingerprint"])
        )
    }

    static func save(
        _ state: OnboardingDraftState,
        defaults: UserDefaults = .standard
    ) {
        var value: [String: Any] = [
            "workflowID": state.workflowID,
            "disabledModules": Array(state.disabledModules).sorted(),
        ]
        if let appliedScopeFingerprint = state.appliedScopeFingerprint {
            value["appliedScopeFingerprint"] = appliedScopeFingerprint
        }
        defaults.set(value, forKey: AirMcpConstants.keyOnboardingDraft)
    }

    static func clear(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: AirMcpConstants.keyOnboardingDraft)
    }

    private static func validatedFingerprint(_ value: Any?) -> String? {
        guard let value = value as? String,
              value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil
        else { return nil }
        return value
    }
}
