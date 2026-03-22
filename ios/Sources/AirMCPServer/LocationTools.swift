// AirMCPServer — MCPTool wrappers for LocationService.

import Foundation
import CoreLocation
import AirMCPKit

// MARK: - Get Current Location

public struct GetCurrentLocationTool: MCPTool {
    public static let name = "location_get_current"
    public static let description = "Get the device's current GPS location (latitude, longitude, altitude, accuracy)."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "timeout": ["type": "number", "description": "Timeout in seconds (default 15)"],
        ] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    public init() {}

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let timeout: TimeInterval
        if let t = arguments["timeout"] as? TimeInterval {
            timeout = t
        } else if let t = arguments["timeout"] as? Int {
            timeout = TimeInterval(t)
        } else {
            timeout = 15
        }

        let fetcher = LocationFetcher()
        let location = try await fetcher.fetch(timeout: timeout)

        let output = LocationOutput(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitude: location.altitude,
            horizontalAccuracy: location.horizontalAccuracy,
            verticalAccuracy: location.verticalAccuracy,
            timestamp: formatISO8601(location.timestamp)
        )
        return .ok(output)
    }
}

// MARK: - Location Permission

public struct LocationPermissionTool: MCPTool {
    public static let name = "location_permission"
    public static let description = "Check the current location authorization status."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    public init() {}

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let manager = CLLocationManager()
        let status = manager.authorizationStatus
        let statusString: String
        switch status {
        case .notDetermined:
            statusString = "not_determined"
        case .restricted:
            statusString = "restricted"
        case .denied:
            statusString = "denied"
        case .authorizedAlways:
            statusString = "authorized_always"
        case .authorizedWhenInUse:
            statusString = "authorized_when_in_use"
        @unknown default:
            statusString = "unknown"
        }

        let output: [String: String] = [
            "status": statusString,
            "description": descriptionForStatus(status),
        ]
        return .ok(output)
    }

    private func descriptionForStatus(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return "Location permission has not been requested yet."
        case .restricted:
            return "Location access is restricted by parental controls or device policy."
        case .denied:
            return "Location access denied. Grant access in Settings > Privacy & Security > Location Services."
        case .authorizedAlways:
            return "Location access is authorized (always)."
        case .authorizedWhenInUse:
            return "Location access is authorized (when in use)."
        @unknown default:
            return "Location authorization status is unknown."
        }
    }
}

// MARK: - Registration Helper

public func registerLocationTools(on server: MCPServer) async {
    await server.registerTool(GetCurrentLocationTool())
    await server.registerTool(LocationPermissionTool())
}
