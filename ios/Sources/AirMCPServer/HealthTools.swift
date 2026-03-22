// AirMCPServer — HealthKit MCP tool wrappers.
// All tools are read-only and return only aggregated/summarized data.

#if canImport(HealthKit)
import Foundation
import AirMCPKit

// MARK: - Today Steps Tool

public struct TodayStepsTool: MCPTool {
    public static let name = "health_today_steps"
    public static let description = "Get aggregated step count for today"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: HealthService

    public init(service: HealthService) {
        self.service = service
    }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        do {
            let steps = try await service.todaySteps()
            return .ok(["stepsToday": steps] as [String: Int])
        } catch {
            return .err("Failed to get step count: \(error.localizedDescription)")
        }
    }
}

// MARK: - Recent Heart Rate Tool

public struct RecentHeartRateTool: MCPTool {
    public static let name = "health_recent_heart_rate"
    public static let description = "Get average resting heart rate over the last 7 days (bpm)"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: HealthService

    public init(service: HealthService) {
        self.service = service
    }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        do {
            let avg = try await service.recentHeartRate()
            if let avg {
                return .ok(["heartRateAvg7d": round(avg * 10) / 10] as [String: Double])
            } else {
                return .ok("{\"heartRateAvg7d\":null,\"message\":\"No heart rate data available for the last 7 days\"}")
            }
        } catch {
            return .err("Failed to get heart rate: \(error.localizedDescription)")
        }
    }
}

// MARK: - Sleep Analysis Tool

public struct SleepAnalysisTool: MCPTool {
    public static let name = "health_sleep_analysis"
    public static let description = "Get total sleep hours for a given date (defaults to last night)"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "date": [
                "type": "string",
                "description": "ISO 8601 date string (e.g. 2026-03-22T00:00:00Z). Defaults to today (last night's sleep).",
            ] as [String: Any],
        ] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: HealthService

    public init(service: HealthService) {
        self.service = service
    }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        do {
            let date: Date
            if let dateStr = arguments["date"] as? String, let parsed = parseISO8601(dateStr) {
                date = parsed
            } else {
                date = Date()
            }

            let hours = try await service.sleepHours(for: date)
            let rounded = round(hours * 100) / 100
            return .ok(["sleepHours": rounded] as [String: Double])
        } catch {
            return .err("Failed to get sleep data: \(error.localizedDescription)")
        }
    }
}

// MARK: - Health Summary Tool

public struct HealthSummaryTool: MCPTool {
    public static let name = "health_summary"
    public static let description = "Get a combined health dashboard with aggregated steps, heart rate, sleep, active energy, and exercise minutes"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: HealthService

    public init(service: HealthService) {
        self.service = service
    }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        do {
            let summary = try await service.healthSummary()
            return .ok(summary)
        } catch {
            return .err("Failed to get health summary: \(error.localizedDescription)")
        }
    }
}

// MARK: - Current Medications Tool

public struct CurrentMedicationsTool: MCPTool {
    public static let name = "health_medications"
    public static let description = "List current medications (names only — no dosage details for privacy)"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: HealthService

    public init(service: HealthService) {
        self.service = service
    }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        do {
            let medications = try await service.currentMedications()
            return .ok(medications)
        } catch {
            return .err("Failed to get medications: \(error.localizedDescription)")
        }
    }
}

// MARK: - Medication Adherence Tool

public struct MedicationAdherenceTool: MCPTool {
    public static let name = "health_medication_adherence"
    public static let description = "Get medication adherence percentage over a given number of days (default 7)"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "days": [
                "type": "integer",
                "description": "Number of days to check adherence for (1–90, default 7)",
            ] as [String: Any],
        ] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: HealthService

    public init(service: HealthService) {
        self.service = service
    }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        do {
            let days = arguments["days"] as? Int ?? 7
            let adherence = try await service.medicationAdherence(days: days)
            return .ok(adherence)
        } catch {
            return .err("Failed to get medication adherence: \(error.localizedDescription)")
        }
    }
}

// MARK: - Registration Helper

public func registerHealthTools(on server: MCPServer, service: HealthService) async {
    _ = try? await service.requestAuthorization()
    await server.registerTool(TodayStepsTool(service: service))
    await server.registerTool(RecentHeartRateTool(service: service))
    await server.registerTool(SleepAnalysisTool(service: service))
    await server.registerTool(HealthSummaryTool(service: service))
    await server.registerTool(CurrentMedicationsTool(service: service))
    await server.registerTool(MedicationAdherenceTool(service: service))
}
#endif
