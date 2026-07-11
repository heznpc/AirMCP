enum RuntimeStartConsentPolicy {
    /// Notification authorization is never an ambient launch side effect. It
    /// is relevant only when HITL is enabled and the current event is an
    /// explicit user runtime-start action.
    nonisolated static func shouldRequestApprovalNotifications(
        hitlLevel: HitlLevel,
        userInitiated: Bool
    ) -> Bool {
        userInitiated && hitlLevel != .off
    }
}
