import AppKit
import Foundation

/// A value-only snapshot keeps the single-instance choice deterministic and
/// testable without constructing `NSRunningApplication` objects in tests.
struct RunningApplicationSnapshot: Sendable, Equatable {
    let processIdentifier: pid_t
    let bundleIdentifier: String?
    let launchDate: Date?
    let isTerminated: Bool
}

enum SingleInstancePolicy {
    private nonisolated static func precedes(
        _ lhs: RunningApplicationSnapshot,
        _ rhs: RunningApplicationSnapshot
    ) -> Bool {
        // LaunchServices normally supplies launchDate. If it is unavailable
        // during a direct-executable race, PID is the deterministic tiebreaker
        // so two copies cannot both decide that the other one should win.
        let lhsDate = lhs.launchDate ?? .distantFuture
        let rhsDate = rhs.launchDate ?? .distantFuture
        if lhsDate != rhsDate { return lhsDate < rhsDate }
        return lhs.processIdentifier < rhs.processIdentifier
    }

    /// Returns the oldest *pre-existing* live process for the same bundle.
    /// The current launch yields only when the candidate sorts before itself;
    /// this prevents two simultaneous direct launches from both terminating.
    nonisolated static func existingProcessIdentifier(
        bundleIdentifier: String,
        currentProcessIdentifier: pid_t,
        candidates: [RunningApplicationSnapshot]
    ) -> pid_t? {
        guard let current = candidates.first(where: {
            $0.processIdentifier == currentProcessIdentifier
        }) else { return nil }

        return candidates
            .filter {
                !$0.isTerminated
                    && $0.processIdentifier != currentProcessIdentifier
                    && $0.bundleIdentifier == bundleIdentifier
                    && precedes($0, current)
            }
            .min(by: precedes)?
            .processIdentifier
    }
}
