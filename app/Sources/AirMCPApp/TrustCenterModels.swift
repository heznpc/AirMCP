import Foundation

// MARK: - Audit wire contract

/// A normalized audit event returned by `audit_log`.
///
/// Deliberately does not decode `args`, raw error text, HMAC envelope fields,
/// filesystem paths, or credentials. The Trust Center can therefore never
/// accidentally persist those fields in its shareable report model.
struct AuditEntryRecord: Decodable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable {
        case toolCall = "tool_call"
        case approval
        case gate
        case unknown

        init(wireValue: String?) {
            guard let wireValue else {
                self = .toolCall
                return
            }
            self = wireValue == "tool" ? .toolCall : (Kind(rawValue: wireValue) ?? .unknown)
        }
    }

    enum Status: String, Codable, Sendable {
        case ok
        case error
    }

    enum ApprovalDecision: String, Codable, Sendable {
        case approved
        case denied
        case timedOut = "timed_out"
        case unavailable
        case unknown

        init(wireValue: String?) {
            guard let wireValue else {
                self = .unknown
                return
            }
            switch wireValue {
            case "approved": self = .approved
            case "denied", "rejected": self = .denied
            case "timed_out", "timeout": self = .timedOut
            case "unavailable": self = .unavailable
            default: self = .unknown
            }
        }
    }

    enum ApprovalChannel: String, Codable, Sendable {
        case socket
        case elicitation
        case unavailable
        case unknown

        init(wireValue: String?) {
            guard let wireValue else {
                self = .unknown
                return
            }
            self = ApprovalChannel(rawValue: wireValue) ?? .unknown
        }
    }

    let id: UUID
    let timestamp: String
    let tool: String
    let status: Status
    let durationMs: Int?
    let correlationId: String?
    let actor: String?
    let kind: Kind
    let gate: String?
    let errorCategory: String?
    let approvalDecision: ApprovalDecision
    let approvalChannel: ApprovalChannel

    private struct ApprovalEnvelope: Decodable {
        let decision: String?
        let channel: String?
    }

    private enum CodingKeys: String, CodingKey {
        case timestamp
        case tool
        case status
        case durationMs
        case correlationId
        case actor
        case kind
        case eventType
        case gate
        case errorCategory
        case approvalDecision
        case approvalChannel
        case approval
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = UUID()
        timestamp = try container.decode(String.self, forKey: .timestamp)
        tool = try container.decode(String.self, forKey: .tool)
        status = try container.decode(Status.self, forKey: .status)
        durationMs = try container.decodeIfPresent(Int.self, forKey: .durationMs)
        correlationId = try container.decodeIfPresent(String.self, forKey: .correlationId)
        actor = try container.decodeIfPresent(String.self, forKey: .actor)
        let kindValue = try container.decodeIfPresent(String.self, forKey: .kind)
            ?? container.decodeIfPresent(String.self, forKey: .eventType)
        kind = Kind(wireValue: kindValue)
        gate = try container.decodeIfPresent(String.self, forKey: .gate)
        errorCategory = try container.decodeIfPresent(String.self, forKey: .errorCategory)

        let envelope = try container.decodeIfPresent(ApprovalEnvelope.self, forKey: .approval)
        let decision = try container.decodeIfPresent(String.self, forKey: .approvalDecision) ?? envelope?.decision
        let channel = try container.decodeIfPresent(String.self, forKey: .approvalChannel) ?? envelope?.channel
        approvalDecision = ApprovalDecision(wireValue: decision)
        approvalChannel = ApprovalChannel(wireValue: channel)
    }

    var date: Date? { AirMCPDateParser.date(from: timestamp) }

    var isGateFailure: Bool {
        if kind == .gate || gate != nil { return true }
        guard status == .error, let errorCategory else { return false }
        return [
            "forbidden",
            "permission_denied",
            "hitl_timeout",
            "rate_limited",
            "emergency_stop",
            "approval_unavailable",
        ].contains(errorCategory)
    }
}

struct AuditBreakRecord: Decodable, Sendable {
    let file: String?
    let lineIndex: Int?
    let reason: String
}

struct AuditLogResponse: Decodable, Sendable {
    let total: Int
    let returned: Int
    let scannedFiles: Int
    let entries: [AuditEntryRecord]
    let verified: Bool?
    let verifiedFirstBreak: AuditBreakRecord?
    let auditDisabled: Bool

    private struct IntegrityEnvelope: Decodable {
        let verified: Bool?
        let firstBreak: AuditBreakRecord?
        let auditDisabled: Bool?
    }

    private enum CodingKeys: String, CodingKey {
        case total
        case returned
        case scannedFiles
        case entries
        case history
        case verified
        case firstBreak
        case verifiedFirstBreak
        case auditDisabled
        case integrity
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        scannedFiles = try container.decodeIfPresent(Int.self, forKey: .scannedFiles) ?? 0
        // Runtime revisions may publish `history` as the redacted UI alias
        // while retaining `entries` for compatibility. Prefer the explicit UI
        // history when both are present.
        entries = try container.decodeIfPresent([AuditEntryRecord].self, forKey: .history)
            ?? container.decodeIfPresent([AuditEntryRecord].self, forKey: .entries)
            ?? []
        returned = try container.decodeIfPresent(Int.self, forKey: .returned) ?? entries.count
        let integrity = try container.decodeIfPresent(IntegrityEnvelope.self, forKey: .integrity)
        verified = try container.decodeIfPresent(Bool.self, forKey: .verified) ?? integrity?.verified
        verifiedFirstBreak = try container.decodeIfPresent(AuditBreakRecord.self, forKey: .firstBreak)
            ?? container.decodeIfPresent(AuditBreakRecord.self, forKey: .verifiedFirstBreak)
            ?? integrity?.firstBreak
        auditDisabled = try container.decodeIfPresent(Bool.self, forKey: .auditDisabled)
            ?? integrity?.auditDisabled
            ?? false
    }
}

enum AuditIntegrityState: String, Codable, Sendable {
    case verified
    case failed
    case disabled
    case unavailable
}

struct AuditIntegrity: Sendable {
    let state: AuditIntegrityState
    let breakReason: String?
    let scannedFiles: Int

    init(response: AuditLogResponse?) {
        guard let response else {
            state = .unavailable
            breakReason = nil
            scannedFiles = 0
            return
        }
        scannedFiles = response.scannedFiles
        breakReason = response.verifiedFirstBreak?.reason
        if response.auditDisabled {
            state = .disabled
        } else if response.verified == true {
            state = .verified
        } else if response.verified == false {
            state = .failed
        } else {
            state = .unavailable
        }
    }
}

// MARK: - Run grouping

struct LivePendingApproval: Identifiable, Sendable {
    let id: String
    let correlationId: String?
    let tool: String
    let args: [String: String]
    let destructive: Bool
    let sensitive: Bool
    let openWorld: Bool
    let timestamp: Date
}

struct LiveApprovalRecord: Identifiable, Sendable {
    let id: String
    let correlationId: String?
    let tool: String
    let status: ApprovalStatus
    let timestamp: Date
}

enum ApprovalStatus: String, Codable, Sendable {
    case notRequired = "not_required"
    case pending
    case approved
    case denied
    case timedOut = "timed_out"
    case unavailable
}

enum GovernedRunStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case running
    case succeeded
    case failed
    case denied
    case timedOut = "timed_out"
    case blocked
}

struct GovernedRun: Identifiable, Sendable {
    let id: String
    let correlationId: String?
    var entries: [AuditEntryRecord]
    var pendingApprovals: [LivePendingApproval]
    var liveApproval: LiveApprovalRecord?

    var startedAt: Date {
        let dates = entries.compactMap(\.date)
            + pendingApprovals.map(\.timestamp)
            + [liveApproval?.timestamp].compactMap { $0 }
        return dates.min() ?? .distantPast
    }

    var endedAt: Date {
        let dates = entries.compactMap(\.date)
            + pendingApprovals.map(\.timestamp)
            + [liveApproval?.timestamp].compactMap { $0 }
        return dates.max() ?? startedAt
    }

    var title: String {
        if let pendingApproval = pendingApprovals.first { return pendingApproval.tool }
        if let firstTool = entries.first(where: { $0.kind != .approval })?.tool { return firstTool }
        return liveApproval?.tool ?? entries.first?.tool ?? "AirMCP run"
    }

    var actorClass: String {
        guard let actor = entries.compactMap(\.actor).first else { return "user" }
        if actor.hasPrefix("daemon-skill:") { return "daemon" }
        if actor == "hitl-approved" { return "hitl-approved" }
        return "user"
    }

    var approvalStatus: ApprovalStatus {
        if !pendingApprovals.isEmpty { return .pending }
        if let liveApproval { return liveApproval.status }
        guard let decision = entries
            .filter({ $0.kind == .approval && $0.approvalDecision != .unknown })
            .last?
            .approvalDecision
        else { return .notRequired }
        switch decision {
        case .approved: return .approved
        case .denied: return .denied
        case .timedOut: return .timedOut
        case .unavailable: return .unavailable
        case .unknown: return .notRequired
        }
    }

    var status: GovernedRunStatus {
        if !pendingApprovals.isEmpty { return .pending }
        switch approvalStatus {
        case .denied:
            return .denied
        case .timedOut:
            return .timedOut
        case .unavailable:
            return .blocked
        case .approved where entries.isEmpty:
            return .running
        default:
            break
        }
        if entries.contains(where: \.isGateFailure) { return .blocked }
        if entries.contains(where: { $0.status == .error }) { return .failed }
        if entries.isEmpty { return .running }
        return .succeeded
    }

    var durationMs: Int {
        entries
            .filter { $0.kind == .toolCall }
            .compactMap(\.durationMs)
            .reduce(0, +)
    }

    var toolCount: Int {
        entries.filter { $0.kind == .toolCall }.count
    }

    static func grouped(entries: [AuditEntryRecord]) -> [GovernedRun] {
        var grouped: [String: [AuditEntryRecord]] = [:]
        for entry in entries {
            // Never merge legacy rows merely because they lack correlation.
            let key = entry.correlationId ?? "legacy:\(entry.id.uuidString.lowercased())"
            grouped[key, default: []].append(entry)
        }
        return grouped.map { key, values in
            GovernedRun(
                id: key,
                correlationId: values.first?.correlationId,
                entries: values.sorted(by: AuditEntryRecord.timelineOrder),
                pendingApprovals: [],
                liveApproval: nil
            )
        }
        .sorted { $0.startedAt > $1.startedAt }
    }

    /// Strip in-memory approval state before creating a shareable report.
    /// Only rows returned by `audit_log` participate in the integrity verdict.
    var persistedEvidenceOnly: GovernedRun {
        GovernedRun(
            id: id,
            correlationId: correlationId,
            entries: entries,
            pendingApprovals: [],
            liveApproval: nil
        )
    }

}

private extension AuditEntryRecord {
    static func timelineOrder(_ lhs: AuditEntryRecord, _ rhs: AuditEntryRecord) -> Bool {
        if lhs.timestamp != rhs.timestamp { return lhs.timestamp < rhs.timestamp }
        if lhs.kind == .approval && rhs.kind != .approval { return true }
        return false
    }
}

// MARK: - Safe export model

struct TrustExportReport: Encodable, Sendable {
    struct Window: Encodable, Sendable {
        let since: String
        let snapshotMatchedEvents: Int
        let snapshotReturnedEvents: Int
        let exportedEvents: Int
        let exportedRuns: Int
        let snapshotTruncated: Bool
    }

    struct Integrity: Encodable, Sendable {
        let state: AuditIntegrityState
        let scope: String
        let liveStateExcluded: Bool
        let breakReason: String?
        let scannedFiles: Int
    }

    struct Run: Encodable, Sendable {
        let id: String
        let correlationId: String?
        let status: GovernedRunStatus
        let approval: ApprovalStatus
        let actorClass: String
        let startedAt: String
        let endedAt: String
        let steps: [Step]
    }

    struct Step: Encodable, Sendable {
        let timestamp: String
        let kind: AuditEntryRecord.Kind
        let tool: String
        let status: AuditEntryRecord.Status
        let durationMs: Int?
        let gate: String?
        let errorCategory: String?
        let approvalDecision: AuditEntryRecord.ApprovalDecision?
        let approvalChannel: AuditEntryRecord.ApprovalChannel?
    }

    let schemaVersion: Int
    let generatedAt: String
    let airmcpVersion: String
    let notice: String
    let window: Window
    let integrityAtExport: Integrity
    let runs: [Run]

    static func make(
        version: String,
        since: Date,
        response: AuditLogResponse?,
        runs: [GovernedRun],
        now: Date = Date()
    ) -> TrustExportReport {
        let integrity = AuditIntegrity(response: response)
        let persistedRuns = runs
            .map(\.persistedEvidenceOnly)
            .filter { !$0.entries.isEmpty }
        return TrustExportReport(
            schemaVersion: 1,
            generatedAt: AirMCPDateParser.string(from: now),
            airmcpVersion: version,
            notice: "Redacted persisted-audit report. Live pending/recent approvals are excluded. Integrity applies only to the accepted local audit snapshot at export time; this file is not the original HMAC evidence.",
            window: Window(
                since: AirMCPDateParser.string(from: since),
                snapshotMatchedEvents: response?.total ?? 0,
                snapshotReturnedEvents: response?.returned ?? 0,
                exportedEvents: persistedRuns.reduce(0) { $0 + $1.entries.count },
                exportedRuns: persistedRuns.count,
                snapshotTruncated: (response?.returned ?? 0) < (response?.total ?? 0)
            ),
            integrityAtExport: Integrity(
                state: integrity.state,
                scope: "persisted_audit_snapshot_only",
                liveStateExcluded: true,
                breakReason: integrity.breakReason,
                scannedFiles: integrity.scannedFiles
            ),
            runs: persistedRuns.map { run in
                Run(
                    id: run.id,
                    correlationId: run.correlationId,
                    status: run.status,
                    approval: run.approvalStatus,
                    actorClass: run.actorClass,
                    startedAt: AirMCPDateParser.string(from: run.startedAt),
                    endedAt: AirMCPDateParser.string(from: run.endedAt),
                    steps: run.entries.map { entry in
                        Step(
                            timestamp: entry.timestamp,
                            kind: entry.kind,
                            tool: entry.tool,
                            status: entry.status,
                            durationMs: entry.durationMs,
                            gate: entry.gate,
                            errorCategory: entry.errorCategory,
                            approvalDecision: entry.approvalDecision == .unknown ? nil : entry.approvalDecision,
                            approvalChannel: entry.approvalChannel == .unknown ? nil : entry.approvalChannel
                        )
                    }
                )
            }
        )
    }
}

enum AirMCPDateParser {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
