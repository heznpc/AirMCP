// AirMCPKit — CoreLocation service shared between macOS and iOS.

import Foundation
import CoreLocation

/// @unchecked Sendable is safe: all mutable state (`continuation`, `manager`) is
/// synchronized through `queue` (serial DispatchQueue). NSObject inheritance prevents actor usage.
public class LocationFetcher: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var manager: CLLocationManager?
    private var timeoutWorkItem: DispatchWorkItem?
    private let queue = DispatchQueue(label: "com.airmcp.location")

    public override init() { super.init() }

    public func fetch(timeout: TimeInterval = 15) async throws -> CLLocation {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { cont in
                DispatchQueue.main.async {
                    let mgr = CLLocationManager()
                    mgr.delegate = self
                    mgr.desiredAccuracy = kCLLocationAccuracyBest

                    let timeoutItem = DispatchWorkItem { [weak self] in
                        self?.finish(.failure(AirMCPKitError.unsupported("Location request timed out after \(Int(timeout))s")))
                    }

                    var accepted = false
                    self.queue.sync {
                        if self.continuation == nil {
                            self.continuation = cont
                            self.manager = mgr
                            self.timeoutWorkItem = timeoutItem
                            accepted = true
                        }
                    }

                    guard accepted else {
                        cont.resume(throwing: AirMCPKitError.unsupported("Location request already in progress"))
                        return
                    }

                    DispatchQueue.main.asyncAfter(deadline: .now() + max(timeout, 0.1), execute: timeoutItem)
                    mgr.requestLocation()
                }
            }
        } onCancel: {
            finish(.failure(AirMCPKitError.unsupported("Location request cancelled")))
        }
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
        }

        timeoutItem?.cancel()
        mgr?.stopUpdatingLocation()
        mgr?.delegate = nil

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
