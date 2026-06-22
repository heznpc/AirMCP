// AirMCPKit — CoreLocation service shared between macOS and iOS.

import Foundation
import CoreLocation

/// @unchecked Sendable is safe: all mutable state (`continuation`, `manager`) is
/// synchronized through `queue` (serial DispatchQueue). NSObject inheritance prevents actor usage.
public class LocationFetcher: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var manager: CLLocationManager?
    private var timeoutWorkItem: DispatchWorkItem?
    private var activeRequestID: UUID?
    private let queue = DispatchQueue(label: "com.airmcp.location")

    public override init() { super.init() }

    public func fetch(timeout: TimeInterval = 15) async throws -> CLLocation {
        let requestID = UUID()
        let timeoutSeconds = max(timeout, 0.1)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { cont in
                var accepted = false
                queue.sync {
                    if continuation == nil {
                        continuation = cont
                        activeRequestID = requestID
                        accepted = true
                    }
                }

                guard accepted else {
                    cont.resume(throwing: AirMCPKitError.unsupported("Location request already in progress"))
                    return
                }

                if Task.isCancelled {
                    finish(.failure(AirMCPKitError.unsupported("Location request cancelled")))
                    return
                }

                DispatchQueue.main.async {
                    self.startRequest(id: requestID, timeoutSeconds: timeoutSeconds)
                }
            }
        } onCancel: {
            finish(.failure(AirMCPKitError.unsupported("Location request cancelled")))
        }
    }

    private func startRequest(id: UUID, timeoutSeconds: TimeInterval) {
        let mgr = CLLocationManager()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest

        let timeoutItem = DispatchWorkItem { [weak self] in
            self?.finish(.failure(AirMCPKitError.unsupported("Location request timed out after \(timeoutSeconds)s")))
        }

        var shouldStart = false
        queue.sync {
            if continuation != nil, activeRequestID == id, manager == nil {
                manager = mgr
                timeoutWorkItem = timeoutItem
                shouldStart = true
            }
        }

        guard shouldStart else {
            mgr.delegate = nil
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: timeoutItem)
        mgr.requestLocation()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.first else {
            finish(.failure(AirMCPKitError.unsupported("Location request returned no locations")))
            return
        }
        finish(.success(location))
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<CLLocation, Error>) {
        var cont: CheckedContinuation<CLLocation, Error>?
        var mgr: CLLocationManager?
        var timeoutItem: DispatchWorkItem?

        queue.sync {
            cont = continuation
            continuation = nil
            mgr = manager
            manager = nil
            timeoutItem = timeoutWorkItem
            timeoutWorkItem = nil
            activeRequestID = nil
        }

        timeoutItem?.cancel()
        if let mgr {
            DispatchQueue.main.async {
                mgr.stopUpdatingLocation()
                mgr.delegate = nil
            }
        }

        guard let cont else { return }
        switch result {
        case .success(let location):
            cont.resume(returning: location)
        case .failure(let error):
            cont.resume(throwing: error)
        }
    }
}

public func locationStatusString(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "authorized_always"
    #if os(iOS)
    case .authorizedWhenInUse: return "authorized_when_in_use"
    #endif
    @unknown default: return "unknown"
    }
}
