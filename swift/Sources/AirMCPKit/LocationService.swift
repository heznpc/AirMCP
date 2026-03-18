// AirMCPKit — CoreLocation service shared between macOS and iOS.

import Foundation
import CoreLocation

public class LocationFetcher: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var manager: CLLocationManager?
    private let queue = DispatchQueue(label: "com.airmcp.location")

    public override init() { super.init() }

    public func fetch(timeout: TimeInterval = 15) async throws -> CLLocation {
        try await withThrowingTaskGroup(of: CLLocation.self) { group in
            group.addTask {
                try await withCheckedThrowingContinuation { cont in
                    self.queue.sync { self.continuation = cont }
                    let mgr = CLLocationManager()
                    mgr.delegate = self
                    mgr.desiredAccuracy = kCLLocationAccuracyBest
                    self.manager = mgr
                    mgr.requestLocation()
                }
            }
            group.addTask {
                try await Task.sleep(for: .seconds(timeout))
                throw AirMCPKitError.unsupported("Location request timed out after \(Int(timeout))s")
            }
            guard let result = try await group.next() else {
                throw AirMCPKitError.unsupported("Location request failed")
            }
            group.cancelAll()
            return result
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        queue.sync {
            continuation?.resume(returning: locations[0])
            continuation = nil
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        queue.sync {
            continuation?.resume(throwing: error)
            continuation = nil
        }
    }
}

public func locationStatusString(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "authorized_always"
    @unknown default: return "unknown"
    }
}
