import AppKit
import Foundation
import UniformTypeIdentifiers

@MainActor
@Observable
final class TrustCenterStore {
    enum TimeRange: Int, CaseIterable, Identifiable, Sendable {
        case day = 1
        case week = 7
        case month = 30

        var id: Int { rawValue }

        func since(now: Date = Date()) -> Date {
            Calendar.current.date(byAdding: .day, value: -rawValue, to: now) ?? now
        }
    }

    enum StatusFilter: String, CaseIterable, Identifiable, Sendable {
        case all
        case needsAttention
        case failed
        case succeeded

        var id: String { rawValue }
    }

    struct RunSection: Identifiable, Sendable {
        let day: Date
        let runs: [GovernedRun]
        var id: Date { day }
    }

    var response: AuditLogResponse?
    var persistedRuns: [GovernedRun] = []
    var selectedRunID: String?
    var timeRange: TimeRange = .week
    var statusFilter: StatusFilter = .all
    var searchText = ""
    var isLoading = false
    var loadError: String?
    var exportError: String?
    var lastExportedFilename: String?
    private var refreshGeneration = 0

    var integrity: AuditIntegrity { AuditIntegrity(response: response) }

    func refresh() async {
        refreshGeneration += 1
        let generation = refreshGeneration
        let requestedRange = timeRange
        isLoading = true
        defer {
            if generation == refreshGeneration {
                isLoading = false
            }
        }

        let since = requestedRange.since()
        let args: AppRuntimeToolArguments = [
            "since": AirMCPDateParser.string(from: since),
            "limit": 1_000,
        ]
        do {
            let snapshot: AuditLogResponse = try await AppRuntimeClient.callAppRuntimeToolJSON(
                "audit_log",
                args: args
            )
            guard generation == refreshGeneration else { return }
            response = snapshot
            persistedRuns = GovernedRun.grouped(entries: snapshot.entries)
            loadError = nil
            if selectedRunID == nil || !persistedRuns.contains(where: { $0.id == selectedRunID }) {
                selectedRunID = persistedRuns.first?.id
            }
        } catch {
            guard generation == refreshGeneration else { return }
            response = nil
            persistedRuns = []
            selectedRunID = nil
            loadError = error.localizedDescription
        }
    }

    func mergedRuns(
        pendingRequests: [HitlManager.ApprovalRequest],
        recentRequests: [HitlManager.ApprovalRecord]
    ) -> [GovernedRun] {
        var byID = Dictionary(uniqueKeysWithValues: persistedRuns.map { ($0.id, $0) })

        // Recent in-memory decisions bridge the small window between the user
        // responding and the runtime sealing the corresponding audit event.
        for recent in recentRequests.reversed() {
            let key = recent.correlationId ?? "approval:\(recent.id)"
            let approvalStatus: ApprovalStatus = switch recent.reason {
            case .approved: .approved
            case .denied: .denied
            case .timedOut: .timedOut
            case .unavailable: .unavailable
            }
            let snapshot = LiveApprovalRecord(
                id: recent.id,
                correlationId: recent.correlationId,
                tool: recent.tool,
                status: approvalStatus,
                timestamp: recent.timestamp
            )
            if var existing = byID[key] {
                if !existing.entries.contains(where: { $0.kind == .approval }) {
                    existing.liveApproval = snapshot
                    byID[key] = existing
                }
            } else {
                byID[key] = GovernedRun(
                    id: key,
                    correlationId: recent.correlationId,
                    entries: [],
                    pendingApprovals: [],
                    liveApproval: snapshot
                )
            }
        }

        // Pending always wins over a recent record for the same run: a live
        // approval request is the action the user can affect right now.
        for pending in pendingRequests {
            let key = pending.correlationId ?? "approval:\(pending.id)"
            let snapshot = LivePendingApproval(
                id: pending.id,
                correlationId: pending.correlationId,
                tool: pending.tool,
                args: pending.args,
                destructive: pending.destructive,
                sensitive: pending.sensitive,
                openWorld: pending.openWorld,
                timestamp: pending.timestamp
            )
            if var existing = byID[key] {
                existing.pendingApprovals.removeAll { $0.id == snapshot.id }
                existing.pendingApprovals.append(snapshot)
                existing.pendingApprovals.sort { $0.timestamp < $1.timestamp }
                byID[key] = existing
            } else {
                byID[key] = GovernedRun(
                    id: key,
                    correlationId: pending.correlationId,
                    entries: [],
                    pendingApprovals: [snapshot],
                    liveApproval: nil
                )
            }
        }

        return byID.values.sorted { $0.startedAt > $1.startedAt }
    }

    func persistedEventCount(correlationId: String?) -> Int {
        guard let correlationId else { return 0 }
        return persistedRuns.first(where: { $0.correlationId == correlationId })?.entries.count ?? 0
    }

    func persistedToolEventCount(correlationId: String?, tool: String) -> Int {
        guard let correlationId,
              let run = persistedRuns.first(where: { $0.correlationId == correlationId })
        else { return 0 }
        return run.entries.filter { $0.kind == .toolCall && $0.tool == tool }.count
    }

    /// Refresh one correlated run without replacing the global history window.
    /// Used by the bounded post-approval completion probe so long-running tools
    /// eventually leave the in-memory `running` bridge state.
    @discardableResult
    func refreshPersistedRun(correlationId: String) async -> Int? {
        let args: AppRuntimeToolArguments = [
            "since": AirMCPDateParser.string(from: timeRange.since()),
            "correlationId": correlationId,
            "limit": 1_000,
        ]
        do {
            let snapshot: AuditLogResponse = try await AppRuntimeClient.callAppRuntimeToolJSON(
                "audit_log",
                args: args
            )
            guard let updated = GovernedRun.grouped(entries: snapshot.entries)
                .first(where: { $0.correlationId == correlationId })
            else { return 0 }
            if let index = persistedRuns.firstIndex(where: { $0.correlationId == correlationId }) {
                persistedRuns[index] = updated
            } else {
                persistedRuns.append(updated)
            }
            persistedRuns.sort { $0.startedAt > $1.startedAt }
            return updated.entries.count
        } catch {
            return nil
        }
    }

    func filteredRuns(from runs: [GovernedRun]) -> [GovernedRun] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return runs.filter { run in
            let matchesStatus: Bool
            switch statusFilter {
            case .all:
                matchesStatus = true
            case .needsAttention:
                matchesStatus = [.pending, .failed, .denied, .timedOut, .blocked].contains(run.status)
            case .failed:
                matchesStatus = [.failed, .denied, .timedOut, .blocked].contains(run.status)
            case .succeeded:
                matchesStatus = run.status == .succeeded
            }
            guard matchesStatus else { return false }
            guard !query.isEmpty else { return true }
            return run.title.lowercased().contains(query)
                || run.correlationId?.lowercased().contains(query) == true
                || run.entries.contains(where: {
                    $0.tool.lowercased().contains(query)
                        || $0.errorCategory?.lowercased().contains(query) == true
                })
        }
    }

    func sections(for runs: [GovernedRun]) -> [RunSection] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: runs) { calendar.startOfDay(for: $0.startedAt) }
        return grouped.keys.sorted(by: >).map { day in
            RunSection(day: day, runs: grouped[day, default: []].sorted { $0.startedAt > $1.startedAt })
        }
    }

    func selectedRun(in runs: [GovernedRun]) -> GovernedRun? {
        if let selectedRunID, let selected = runs.first(where: { $0.id == selectedRunID }) {
            return selected
        }
        return runs.first
    }

    func exportRedactedReport(runs: [GovernedRun]) {
        exportError = nil
        lastExportedFilename = nil

        let panel = NSSavePanel()
        panel.title = L("trust.exportTitle")
        panel.prompt = L("trust.export")
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        let day = Date().formatted(.iso8601.year().month().day())
        panel.nameFieldStringValue = "AirMCP-Trust-Report-\(day).json"
        guard panel.runModal() == .OK, let destination = panel.url else { return }

        do {
            let persistedEvidence = runs
                .map(\.persistedEvidenceOnly)
                .filter { !$0.entries.isEmpty }
            let report = TrustExportReport.make(
                version: AirMcpConstants.npmPackageVersion,
                since: timeRange.since(),
                response: response,
                runs: persistedEvidence
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(report)
            try Self.writeOwnerOnlyReport(data, to: destination)
            lastExportedFilename = destination.lastPathComponent
        } catch {
            exportError = error.localizedDescription
        }
    }

    private enum OwnerOnlyWriteError: LocalizedError {
        case createFailed
        case unsafePermissions

        var errorDescription: String? {
            switch self {
            case .createFailed:
                return "Could not create the protected export file."
            case .unsafePermissions:
                return "The destination does not preserve owner-only file permissions."
            }
        }
    }

    /// Write in the destination directory so the final operation is a rename
    /// on the same filesystem. Permission changes and verification happen on
    /// the temporary file first; a chmod/verification failure therefore leaves
    /// no report at the selected destination.
    static func writeOwnerOnlyReport(_ data: Data, to destination: URL) throws {
        let fileManager = FileManager.default
        let directory = destination.deletingLastPathComponent()
        let temp = directory.appendingPathComponent(".airmcp-trust-\(UUID().uuidString).tmp")
        let backupName = ".airmcp-trust-backup-\(UUID().uuidString)"
        let backup = directory.appendingPathComponent(backupName)
        let destinationExisted = fileManager.fileExists(atPath: destination.path)

        func verifyOwnerOnly(_ url: URL) throws {
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            guard let raw = attributes[.posixPermissions] as? NSNumber,
                  raw.intValue & 0o777 == 0o600
            else { throw OwnerOnlyWriteError.unsafePermissions }
        }

        do {
            guard fileManager.createFile(
                atPath: temp.path,
                contents: data,
                attributes: [.posixPermissions: NSNumber(value: 0o600)]
            ) else { throw OwnerOnlyWriteError.createFailed }
            try fileManager.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: temp.path
            )
            try verifyOwnerOnly(temp)

            if destinationExisted {
                _ = try fileManager.replaceItemAt(
                    destination,
                    withItemAt: temp,
                    backupItemName: backupName,
                    options: [.usingNewMetadataOnly, .withoutDeletingBackupItem]
                )
            } else {
                try fileManager.moveItem(at: temp, to: destination)
            }
            try verifyOwnerOnly(destination)
            try? fileManager.removeItem(at: backup)
        } catch {
            try? fileManager.removeItem(at: temp)
            if fileManager.fileExists(atPath: backup.path) {
                try? fileManager.removeItem(at: destination)
                try? fileManager.moveItem(at: backup, to: destination)
            } else if !destinationExisted {
                try? fileManager.removeItem(at: destination)
            }
            throw error
        }
    }
}
