enum TrustCenterRefreshPolicy {
    /// Audit history is evidence, not ambient UI state. Keeping the gate tied
    /// only to the user's current action avoids guessing the effective HITL
    /// policy of an already-running process (which can differ from the config
    /// editor until restart, or be overridden by its launch environment).
    static func allowsAuditHistoryRead(userInitiated: Bool) -> Bool {
        userInitiated
    }
}
